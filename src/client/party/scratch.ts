/**
 * Turntables, the physics and the sound (pure: no three.js, no WebAudio
 * nodes; unit-tested in tests/scratch.test.ts).
 *
 * Platter: a record spinning at 33⅓ rpm. Put a hand on it and it follows the
 * hand round the spindle (angle for angle, backwards too); lift the hand and
 * the motor pulls it back up to speed. Its playback rate is its angular
 * speed over the nominal one: 1 at speed, 0 held still, negative going back.
 *
 * DeckDSP: everything the pool's speaker stacks play. Two records, each its
 * own track looping on its own bar lines: deck A (the left, the house record,
 * what the resident DJ plays) and deck B (the right, for scratches and effects).
 * At rest a record plays off the wall clock (so everyone in a room hears the
 * same bar): its position is (wall time × its speed + its offset) round its
 * loop. Hold it or push it off speed and it plays from where it is at the
 * record's own rate, backwards too; let go and it carries on from wherever it
 * ended up (a real turntable: the offset moves, and is reported back so friends
 * can follow). An offset set from outside (a friend's decks, a re-cue) is
 * crossfaded to, never jumped. A two-channel mixer: a volume fader per deck
 * and an equal-power crossfader (full left only A, centre both, full right
 * only B). And when the headliner's on, her set (the concert's songs, on the
 * same wall clock and schedule: schedule.ts) takes over: out of its own output,
 * for the PA at her stage. Before it the DJ fades the decks out on the
 * schedule (djGain: whatever anyone's doing at the decks), and they stay
 * silent through her set.
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
 * The crossfader's gains for the two decks (0 = all left, 1 = all right): an
 * equal-power curve (cos/sin), so a blend through the middle holds its level:
 * full left only A, the centre both at -3 dB, full right only B.
 */
export function crossfade(x: number): [number, number] {
  const c = Math.max(0, Math.min(1, x));
  if (c <= 0) return [1, 0];
  if (c >= 1) return [0, 1];
  return [Math.cos((c * Math.PI) / 2), Math.sin((c * Math.PI) / 2)];
}

/** Deck controls, set from the main thread each frame. */
export interface DeckParams {
  rateA: number;
  rateB: number;
  holdA: number;
  holdB: number;
  /** Crossfader 0..1 (0: deck A only). */
  xf: number;
  /** Each deck's channel fader, 0..1. */
  volA: number;
  volB: number;
}

/**
 * The decks' audio: call `process` for each block of output. Self-contained
 * (see above): plain fields set in the constructor, Math only.
 */
export class DeckDSP {
  outRate: number;
  /** The two records: samples from the first downbeat, their rate, their loop (s; whole bars). */
  recs: { data: Float32Array | null; sr: number; loop: number }[];
  /** Each record's speed at rest (deck B's beat-match rate) and offset (s). */
  speed: number[];
  off: number[];
  /** The headliner's set: its samples and rate, and when it's on (schedule.ts: start, slot, cycle; wall s). */
  live: { data: Float32Array | null; sr: number };
  sched: { on: number; start: number; slot: number; cycle: number; after?: number; fadeTo?: number; fadeLen?: number };
  /** The DJ's record after each of her sets (played once through on deck A's channel from the end of her slot; `sched.after` its length, s). */
  after: { data: Float32Array | null; sr: number };
  afterAmt: number;
  /** Clock: wall time `w0` (s) at context time `t0`. */
  t0: number;
  w0: number;
  params: { rateA: number; rateB: number; holdA: number; holdB: number; xf: number; volA: number; volB: number };
  decks: { scratch: boolean; pos: number; fade: number; oldOff: number; rate: number }[];
  gains: number[];
  liveAmt: number;
  /** The DJ's scheduled fade on the decks as it's playing (follows djGain on the same 20 ms ramp). */
  djAmt: number;
  /** A record let go somewhere new: its offset changed here (read and cleared by the owner). */
  changed: boolean;
  dcx: number;
  dcy: number;

  constructor(outRate: number) {
    this.outRate = outRate;
    this.recs = [
      { data: null, sr: 32000, loop: 0 },
      { data: null, sr: 32000, loop: 0 },
    ];
    this.speed = [1, 1];
    this.off = [0, 0];
    this.live = { data: null, sr: 32000 };
    this.sched = { on: 0, start: 0, slot: 0, cycle: 1, after: 0 };
    this.after = { data: null, sr: 32000 };
    this.afterAmt = 0;
    this.t0 = 0;
    this.w0 = 0;
    this.params = { rateA: 1, rateB: 1, holdA: 0, holdB: 0, xf: 0, volA: 1, volB: 1 };
    this.decks = [
      { scratch: false, pos: 0, fade: 1, oldOff: 0, rate: 1 },
      { scratch: false, pos: 0, fade: 1, oldOff: 0, rate: 1 },
    ];
    this.gains = [1, 0];
    this.liveAmt = 0;
    this.djAmt = 1;
    this.changed = false;
    this.dcx = 0;
    this.dcy = 0;
  }

  /** Wall time (s) at context time `t`. */
  wall(t: number) {
    return t - this.t0 + this.w0;
  }

  /** Where record `k` is at rest at wall time `w` (with offset `off`), s into its loop. */
  restPos(k: number, w: number, off?: number) {
    const L = this.recs[k].loop;
    if (!(L > 0)) return 0;
    const p = (w * this.speed[k] + (off === undefined ? this.off[k] : off)) % L;
    return p < 0 ? p + L : p;
  }

  /** Record `k`'s sample `p` seconds in (round its loop). */
  read(k: number, p: number) {
    const r = this.recs[k];
    const arr = r.data;
    if (!arr || !(r.loop > 0)) return 0;
    let q = p % r.loop;
    if (q < 0) q += r.loop;
    const x = q * r.sr;
    const i = Math.floor(x);
    if (i + 1 >= arr.length) return arr[arr.length - 1] || 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  /** Seconds into the headliner's set at wall time `w`, or -1 when he's not on. */
  liveAt(w: number) {
    const S = this.sched;
    if (!S.on || !this.live.data || w < S.start || !(S.cycle > 0)) return -1;
    const n = Math.floor((w - S.start) / S.cycle);
    const into = w - S.start - n * S.cycle;
    return into < S.slot ? into : -1;
  }

  /** Seconds into the DJ's after-set record at wall time `w`, or -1 when it isn't playing. */
  afterAt(w: number) {
    const S = this.sched;
    const len = S.after || 0;
    if (!(len > 0) || !this.after.data || w < S.start || !(S.cycle > 0)) return -1;
    const n = Math.floor((w - S.start) / S.cycle);
    const into = w - S.start - n * S.cycle - S.slot;
    return into >= 0 && into < len ? into : -1;
  }

  /**
   * The decks' scheduled level at wall time `w` (schedule.ts fadeGain): the DJ
   * fades them out over `fadeLen` s from `fadeTo` s before her set, and they stay
   * down through it; full again from its end (One More Drop). Only once her set's
   * music is in (else the DJ plays on through it). A fader's curve: the square.
   */
  djGain(w: number) {
    const S = this.sched;
    const L = S.fadeLen || 0;
    if (!S.on || !(L > 0) || !this.live.data || !(S.cycle > 0)) return 1;
    const rel = w - S.start;
    let to = -rel;
    if (rel >= 0) {
      const into = rel - Math.floor(rel / S.cycle) * S.cycle;
      if (into < S.slot) return 0;
      to = S.cycle - into;
    }
    let g = (to - ((S.fadeTo || 0) - L)) / L;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    return g * g;
  }

  readAfter(into: number) {
    const arr = this.after.data;
    if (!arr) return 0;
    const x = into * this.after.sr;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= arr.length) return 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  readLive(into: number) {
    const arr = this.live.data;
    if (!arr) return 0;
    const x = into * this.live.sr;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= arr.length) return 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  /** Move record `k` to a new offset (a friend's decks, a re-cue): crossfaded over 30 ms. */
  setOffset(k: number, off: number) {
    const L = this.recs[k].loop;
    let d = off - this.off[k];
    if (L > 0) d -= L * Math.round(d / L);
    if (Math.abs(d) < 0.0005) return;
    const D = this.decks[k];
    D.oldOff = this.off[k];
    D.fade = 0;
    this.off[k] = off;
  }

  /**
   * One deck's mode for this block: playing from where it is while it's held or
   * off speed; let go and back at speed, it carries on from there (its offset moves).
   */
  mode(k: number, hold: number, rate: number, w: number) {
    const D = this.decks[k];
    const want = hold > 0.5 || Math.abs(rate - 1) > 0.004;
    if (want && !D.scratch) {
      D.pos = this.restPos(k, w);
      D.fade = 1;
      D.scratch = true;
    } else if (!want && D.scratch) {
      D.scratch = false;
      const L = this.recs[k].loop;
      let o = D.pos - w * this.speed[k];
      if (L > 0) o = ((o % L) + L) % L;
      this.off[k] = o;
      this.changed = true;
    }
  }

  /**
   * One block: the decks into `out`; her set into `live` if given (the stage's
   * PA: the two crossfade on the same 20 ms ramp), else into `out` with them.
   */
  process(out: Float32Array, n: number, time: number, live?: Float32Array) {
    const P = this.params;
    const sr = this.outRate;
    const wb = this.wall(time);
    this.mode(0, P.holdA, P.rateA, wb);
    this.mode(1, P.holdB, P.rateB, wb);
    const c = Math.max(0, Math.min(1, P.xf));
    const ga1 = (c <= 0 ? 1 : c >= 1 ? 0 : Math.cos((c * Math.PI) / 2)) * Math.max(0, P.volA),
      gb1 = (c <= 0 ? 0 : c >= 1 ? 1 : Math.sin((c * Math.PI) / 2)) * Math.max(0, P.volB);
    const ga0 = this.gains[0],
      gb0 = this.gains[1];
    const rates0 = [this.decks[0].rate, this.decks[1].rate],
      rates1 = [P.rateA, P.rateB];
    const fadeStep = 1 / (0.03 * sr),
      liveStep = 1 / (0.02 * sr);
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / n : 0;
      const w = wb + i / sr;
      let mix = 0;
      for (let k = 0; k < 2; k++) {
        const g = k === 0 ? ga0 + (ga1 - ga0) * u : gb0 + (gb1 - gb0) * u;
        const D = this.decks[k];
        let s: number;
        if (D.scratch) {
          D.pos += ((rates0[k] + (rates1[k] - rates0[k]) * u) * this.speed[k]) / sr;
          s = this.read(k, D.pos);
        } else {
          s = this.read(k, this.restPos(k, w));
          if (D.fade < 1) {
            s = s * D.fade + this.read(k, this.restPos(k, w, D.oldOff)) * (1 - D.fade);
            D.fade = Math.min(1, D.fade + fadeStep);
          }
        }
        if (k === 0 && this.afterAmt > 0) {
          // After her set: the DJ's record in place of the house record on deck A's channel.
          const ai = this.afterAt(w);
          s = s * (1 - this.afterAmt) + (ai >= 0 ? this.readAfter(ai) : 0) * this.afterAmt;
        }
        if (g > 0) mix += s * g;
      }
      this.djAmt += Math.max(-liveStep, Math.min(liveStep, this.djGain(w) - this.djAmt));
      mix *= this.djAmt;
      const aw = this.afterAt(w) >= 0 ? 1 : 0;
      this.afterAmt += Math.max(-liveStep, Math.min(liveStep, aw - this.afterAmt));
      const into = this.liveAt(w);
      const want = into >= 0 ? 1 : 0;
      this.liveAmt += Math.max(-liveStep, Math.min(liveStep, want - this.liveAmt));
      const sung = this.liveAmt > 0 && into >= 0 ? this.readLive(into) * this.liveAmt : 0;
      // Her set on its own bus (the stage's PA) when there's one, else mixed in with the decks.
      const x = live ? mix * (1 - this.liveAmt) : this.liveAmt > 0 ? mix * (1 - this.liveAmt) + sung : mix;
      // A DC blocker: a record held still sits on one sample value.
      const y = x - this.dcx + 0.995 * this.dcy;
      this.dcx = x;
      this.dcy = y;
      out[i] = y;
      if (live) live[i] = sung;
    }
    this.gains[0] = ga1;
    this.gains[1] = gb1;
    this.decks[0].rate = P.rateA;
    this.decks[1].rate = P.rateB;
  }
}
