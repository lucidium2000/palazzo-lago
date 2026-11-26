/**
 * Turntables, the physics and the sound (pure: no three.js, no WebAudio
 * nodes; unit-tested in tests/scratch.test.ts).
 *
 * Platter: a record spinning at 33⅓ rpm. Put a hand on it and it follows the
 * hand round the spindle (angle for angle, backwards too); lift the hand and
 * the motor pulls it back up to speed. Its playback rate is its angular
 * speed over the nominal one: 1 at speed, 0 held still, negative going back.
 *
 * DeckDSP: what the two decks play. The left deck carries the party's set
 * (the DJ's and the headliner's tracks, alternating, in time with the wall
 * clock like everyone else's); the right deck a short battle record looped in
 * time with the bar. While a record is pushed off its speed the deck reads
 * its audio at that rate from where it was ("slip": the set carries on
 * underneath), and when it's back at speed it crossfades back to where the
 * set has got to, so the beat clock everyone dances to never drifts. A
 * crossfader mixes the two (a sharp scratch curve), and the right deck also
 * opens on its own while your hand is on it.
 *
 * DeckDSP is written self-contained (no imports, no outside helpers): its
 * source is shipped as the AudioWorklet's module text.
 */

/** 33⅓ rpm in radians per second. */
export const OMEGA = ((100 / 3) * Math.PI * 2) / 60;

/** Wraps an angle difference into (−π, π]. */
export const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export class Platter {
  /** Turned so far, radians clockwise seen from above (unbounded). */
  angle = 0;
  /** Angular speed (rad/s, + is forward). */
  omega = OMEGA;
  held = false;
  /** The motor: how hard it pulls back to speed (rad/s²) and brakes when switched off. */
  torque = 32;
  motorOn = true;
  private handPrev = 0;
  private spin = 0;

  /** 1 at speed, 0 when held still, negative backwards. */
  get rate() {
    return this.omega / OMEGA;
  }

  /** A hand lands on the record at `handAngle` (radians clockwise from above, any wrap). */
  touch(handAngle: number) {
    this.held = true;
    this.handPrev = handAngle;
    this.spin = this.omega;
  }

  /**
   * The hand moved to `handAngle` over `dt`: the record turns with it.
   * (Hands jitter frame to frame: the speed is smoothed over ~20 ms.)
   */
  drag(handAngle: number, dt: number) {
    if (!this.held) this.touch(handAngle);
    const d = wrapAngle(handAngle - this.handPrev);
    this.handPrev = handAngle;
    this.angle += d;
    if (dt > 0) {
      const inst = d / dt;
      const k = 1 - Math.exp(-dt / 0.02);
      this.spin += (inst - this.spin) * k;
      this.omega = this.spin;
    }
  }

  release() {
    this.held = false;
  }

  /** One step while nobody holds it: the motor brings it (back) to speed. */
  update(dt: number) {
    if (this.held || dt <= 0) return;
    const want = this.motorOn ? OMEGA : 0;
    const dv = want - this.omega;
    const step = this.torque * dt;
    this.omega = Math.abs(dv) <= step ? want : this.omega + Math.sign(dv) * step;
    this.angle += this.omega * dt;
  }
}

/**
 * The crossfader's gains for the two decks (0 = all left, 1 = all right). A
 * scratch curve: both full across the middle, cutting hard at the ends.
 */
export function crossfade(x: number): [number, number] {
  const c = Math.max(0, Math.min(1, x));
  const a = c <= 0.85 ? 1 : (1 - c) / 0.15;
  const b = c >= 0.15 ? 1 : c / 0.15;
  return [a, b];
}

/** Deck controls, set from the main thread each frame. */
export interface DeckParams {
  rateA: number;
  rateB: number;
  holdA: number;
  holdB: number;
  /** Crossfader 0..1. */
  xf: number;
}

/**
 * The decks' audio: call `process` for each block of output. Self-contained
 * (see above): plain fields set in the constructor, Math only.
 */
export class DeckDSP {
  outRate: number;
  /** The set's tracks (played one after another), their sample rate and the length of each (s). */
  tracks: (Float32Array | null)[];
  trackRate: number;
  trackLoop: number;
  /** The battle record (s). */
  rec: Float32Array | null;
  recRate: number;
  recLoop: number;
  /** Clock: the set is `p0` seconds in at context time `t0`. */
  t0: number;
  p0: number;
  params: { rateA: number; rateB: number; holdA: number; holdB: number; xf: number };
  a: { scratch: boolean; pos: number; blend: number; rate: number };
  b: { scratch: boolean; pos: number; blend: number; rate: number };
  open: number;
  dcx: number;
  dcy: number;

  constructor(outRate: number) {
    this.outRate = outRate;
    this.tracks = [];
    this.trackRate = 32000;
    this.trackLoop = 0;
    this.rec = null;
    this.recRate = 32000;
    this.recLoop = 0;
    this.t0 = 0;
    this.p0 = 0;
    this.params = { rateA: 1, rateB: 1, holdA: 0, holdB: 0, xf: 0 };
    this.a = { scratch: false, pos: 0, blend: 0, rate: 1 };
    this.b = { scratch: false, pos: 0, blend: 0, rate: 1 };
    this.open = 0;
    this.dcx = 0;
    this.dcy = 0;
  }

  /** The set's whole length (s): one loop per track. */
  period() {
    return this.trackLoop * Math.max(1, this.tracks.length);
  }

  /** Where the set is at context time `t` (s into the period). */
  setPos(t: number) {
    const per = this.period();
    if (!(per > 0)) return 0;
    const p = (t - this.t0 + this.p0) % per;
    return p < 0 ? p + per : p;
  }

  /** The set's sample at `p` seconds into the period (tracks not ready yet play the first one). */
  readSet(p: number) {
    const L = this.trackLoop;
    if (!(L > 0)) return 0;
    const seg = Math.floor(p / L);
    const arr = this.tracks[seg % this.tracks.length] || this.tracks[0];
    if (!arr) return 0;
    const x = (p - seg * L) * this.trackRate;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= arr.length) return 0;
    const f = x - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  readRec(p: number) {
    const arr = this.rec;
    if (!arr || !(this.recLoop > 0)) return 0;
    let q = p % this.recLoop;
    if (q < 0) q += this.recLoop;
    const x = q * this.recRate;
    const i = Math.floor(x);
    if (i + 1 >= arr.length) return arr[arr.length - 1] || 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  /**
   * One deck's mode for this block: scratching while held or off speed; back to
   * the clock (a short crossfade) once it's at speed again.
   */
  mode(d: { scratch: boolean; pos: number; blend: number; rate: number }, hold: number, rate: number, clockPos: number) {
    const want = hold > 0.5 || Math.abs(rate - 1) > 0.004;
    if (want && !d.scratch) {
      // Picks up exactly where the audio is (no jump), unless it was still fading back.
      if (d.blend <= 0) d.pos = clockPos;
      d.scratch = true;
    } else if (!want && d.scratch) d.scratch = false;
  }

  process(out: Float32Array, n: number, time: number) {
    const P = this.params;
    const sr = this.outRate;
    const per = this.period();
    const pa0 = this.setPos(time);
    this.mode(this.a, P.holdA, P.rateA, pa0);
    this.mode(this.b, P.holdB, P.rateB, pa0);
    const c = Math.max(0, Math.min(1, P.xf));
    const ga = c <= 0.85 ? 1 : (1 - c) / 0.15;
    const gb = c >= 0.15 ? 1 : c / 0.15;
    const fade = 1 / (0.025 * sr);
    const ra0 = this.a.rate,
      rb0 = this.b.rate;
    const ra1 = P.rateA,
      rb1 = P.rateB;
    const openK = P.holdB > 0.5 ? 1 / (0.004 * sr) : 1 / (0.3 * sr);
    const A = this.a,
      B = this.b;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / n : 0;
      const ra = ra0 + (ra1 - ra0) * u,
        rb = rb0 + (rb1 - rb0) * u;
      let pc = pa0 + i / sr;
      if (per > 0 && pc >= per) pc -= per;
      // Deck A: the set.
      A.blend = A.scratch ? 1 : Math.max(0, A.blend - fade);
      let sa: number;
      if (A.blend > 0) {
        A.pos += ra / sr;
        if (per > 0) A.pos = ((A.pos % per) + per) % per;
        const s = this.readSet(A.pos);
        sa = A.blend >= 1 ? s : s * A.blend + this.readSet(pc) * (1 - A.blend);
      } else sa = this.readSet(pc);
      // Deck B: the battle record, in time with the bar.
      B.blend = B.scratch ? 1 : Math.max(0, B.blend - fade);
      let sb: number;
      if (B.blend > 0) {
        B.pos += rb / sr;
        const s = this.readRec(B.pos);
        sb = B.blend >= 1 ? s : s * B.blend + this.readRec(pc) * (1 - B.blend);
      } else sb = this.readRec(pc);
      const want = P.holdB > 0.5 ? 1 : 0;
      this.open += Math.max(-openK, Math.min(openK, want - this.open));
      const x = sa * ga + sb * Math.max(gb, this.open) * 0.9;
      // A DC blocker: a record held still sits on one sample value.
      const y = x - this.dcx + 0.995 * this.dcy;
      this.dcx = x;
      this.dcy = y;
      out[i] = y;
    }
    A.rate = ra1;
    B.rate = rb1;
  }
}
