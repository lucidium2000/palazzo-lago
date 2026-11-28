/**
 * Fight mode's match: a best-of-three, arcade style. When a fight starts
 * (you and a guest who's boiled over, or you and a friend trading punches)
 * it becomes a versus moment:
 *
 *   intro  (the power bars slam in, the names)
 *   round  ("ROUND 1" / "ROUND 2" / "FINAL ROUND")
 *   fight  ("FIGHT!": punches count from here)
 *   live   (the round clock runs)
 *   ko     ("K.O.!", the slow-motion beat)  or  time ("TIME!": most health left wins the round)
 *   down   (the one who went down gets up, groggy; both back to full)
 *   ...    the next round, until someone has two
 *   result ("YOU WIN" / "YOU LOSE" / "PERFECT" / "DRAW")
 *   over   (done; "FIGHT OVER" if it was cut short: you walked, they ran, security)
 *
 * One machine runs a match (whoever's fight it is: the player fighting the
 * guest, or the lower id of two friends); it publishes `snapshot()`s, and
 * everyone else (the friend in it, players watching) follows them with a
 * MatchView. `hudState` turns either into what the power bars show, from
 * where you stand (you on the left when you're in it).
 *
 * Pure (no three.js, no DOM) so it can be unit tested: tests/fightmode.test.ts.
 */

export type MatchPhase = 'intro' | 'round' | 'fight' | 'live' | 'ko' | 'time' | 'down' | 'result' | 'over';
/** Phase ids on the wire. */
export const MATCH_PHASES: readonly MatchPhase[] = ['intro', 'round', 'fight', 'live', 'ko', 'time', 'down', 'result', 'over'];

/** Phase lengths (s). */
export const MT = {
  intro: 1.8,
  round: 1.5,
  fight: 0.9,
  ko: 1.8,
  time: 1.6,
  /** Between rounds: at least this long, at most `downMax` waiting for the one who went down. */
  downMin: 1.4,
  downMax: 14,
  result: 3.6,
  over: 2.6,
};
/** The round clock (s). */
export const ROUND_TIME = 45;
/** Rounds to win. */
export const TO_WIN = 2;
/** Never more rounds than this (draws on time can go on): then it's decided as it stands. */
export const MAX_ROUNDS = 5;

export interface FighterInfo {
  /** 'p:<player id>' for a player, 'n:<owner>:<crowd index>' for a guest. */
  id: string;
  name: string;
}

/** Per frame, what the fight looks like to the one running it. */
export interface MatchInput {
  /** Health left, 0..1, per side. */
  hp: [number, number];
  /** Knocked out (on the floor, or out cold) right now. */
  down: [boolean, boolean];
  /** Back on their feet (not knocked out, not still getting up). */
  up: [boolean, boolean];
}

export type MatchEvent =
  | { k: 'intro' }
  | { k: 'round'; n: number; final: boolean }
  | { k: 'fight' }
  | { k: 'ko'; loser: 0 | 1 | 2 }
  | { k: 'time'; winner: 0 | 1 | 2 }
  /** Both back to full health (a new round). */
  | { k: 'reset' }
  | { k: 'result'; winner: 0 | 1 | 2; perfect: boolean }
  | { k: 'over'; abort: boolean };

/** On the wire: a match as it stands. Small, JSON. */
export interface MatchSnap {
  /** Match id ("<host>:<n>"). */
  id: string;
  /** Bumps on every phase change (newest wins). */
  sq: number;
  ph: number;
  /** Seconds into the phase. */
  t: number;
  r: number;
  w: [number, number];
  /** Round clock left (s). */
  tm: number;
  /** Who took the last round (0, 1; 2 a draw; -1 none yet). */
  rw: number;
  /** The match's winner (0, 1; 2 a draw; -1 not decided). */
  win: number;
  pf: 0 | 1;
  /** Cut short. */
  ab: 0 | 1;
  a: { id: string; n: string; hp: number };
  b: { id: string; n: string; hp: number };
  /** Where it is (m), for who's watching. */
  x: number;
  z: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function isFinal(round: number, wins: readonly [number, number]) {
  return round >= 3 || (wins[0] === TO_WIN - 1 && wins[1] === TO_WIN - 1);
}

export function roundLabel(round: number, wins: readonly [number, number]) {
  return isFinal(round, wins) ? 'FINAL ROUND' : `ROUND ${round}`;
}

/** Punches count (the bell's gone, nobody's down). */
export function isLive(ph: MatchPhase) {
  return ph === 'fight' || ph === 'live';
}

export class Match {
  phase: MatchPhase = 'intro';
  t = 0;
  round = 1;
  wins: [number, number] = [0, 0];
  timer = ROUND_TIME;
  roundWinner = -1;
  winner = -1;
  perfect = false;
  aborted = false;
  seq = 1;
  hp: [number, number] = [1, 1];
  /** Took any damage this round, per side (a perfect is a round without it). */
  private hurt: [boolean, boolean] = [false, false];
  x = 0;
  z = 0;

  constructor(
    readonly id: string,
    readonly a: FighterInfo,
    readonly b: FighterInfo,
  ) {}

  get live() {
    return isLive(this.phase);
  }

  /** Finished (its last banner shown too). */
  get done() {
    return this.phase === 'over' && this.t >= MT.over;
  }

  /** Still being fought (not in the result or the end). */
  get on() {
    return this.phase !== 'result' && this.phase !== 'over';
  }

  private go(p: MatchPhase) {
    this.phase = p;
    this.t = 0;
    this.seq++;
  }

  /** Cut short (walked away, ran off, security, someone left): FIGHT OVER. */
  abort(): MatchEvent[] {
    if (this.phase === 'over') return [];
    if (this.phase === 'result') {
      this.go('over');
      return [{ k: 'over', abort: false }];
    }
    this.aborted = true;
    this.go('over');
    return [{ k: 'over', abort: true }];
  }

  update(dt: number, i: MatchInput): MatchEvent[] {
    const ev: MatchEvent[] = [];
    this.t += dt;
    for (const s of [0, 1] as const) {
      if (i.hp[s] < this.hp[s] - 1e-4 && this.phase !== 'down') this.hurt[s] = true;
      this.hp[s] = Math.max(0, Math.min(1, i.hp[s]));
    }
    switch (this.phase) {
      case 'intro':
        if (this.t >= MT.intro) {
          this.go('round');
          ev.push({ k: 'round', n: this.round, final: isFinal(this.round, this.wins) });
        }
        break;
      case 'round':
        if (this.t >= MT.round) {
          this.go('fight');
          ev.push({ k: 'fight' });
        }
        break;
      case 'fight':
      case 'live': {
        if (this.phase === 'fight' && this.t >= MT.fight) this.go('live');
        this.timer = Math.max(0, this.timer - dt);
        const ko0 = i.down[0] || this.hp[0] <= 0,
          ko1 = i.down[1] || this.hp[1] <= 0;
        if (ko0 || ko1) {
          const loser: 0 | 1 | 2 = ko0 && ko1 ? 2 : ko0 ? 0 : 1;
          this.endRound(loser === 2 ? 2 : loser === 0 ? 1 : 0);
          this.go('ko');
          ev.push({ k: 'ko', loser });
        } else if (this.timer <= 0) {
          const d = this.hp[0] - this.hp[1];
          const w: 0 | 1 | 2 = Math.abs(d) < 0.005 ? 2 : d > 0 ? 0 : 1;
          this.endRound(w);
          this.go('time');
          ev.push({ k: 'time', winner: w });
        }
        break;
      }
      case 'ko':
      case 'time':
        if (this.t >= (this.phase === 'ko' ? MT.ko : MT.time)) {
          if (this.decided()) ev.push(...this.finish());
          else this.go('down');
        }
        break;
      case 'down': {
        const ready = i.up[0] && i.up[1];
        if ((ready && this.t >= MT.downMin) || this.t >= MT.downMax) {
          this.round++;
          this.timer = ROUND_TIME;
          this.hurt = [false, false];
          this.hp = [1, 1];
          ev.push({ k: 'reset' });
          this.go('round');
          ev.push({ k: 'round', n: this.round, final: isFinal(this.round, this.wins) });
        }
        break;
      }
      case 'result':
        if (this.t >= MT.result) {
          this.go('over');
          ev.push({ k: 'over', abort: false });
        }
        break;
      case 'over':
        break;
    }
    return ev;
  }

  private endRound(w: 0 | 1 | 2) {
    this.roundWinner = w;
    if (w !== 2) this.wins[w]++;
    this.perfect = w !== 2 && !this.hurt[w];
  }

  private decided() {
    return this.wins[0] >= TO_WIN || this.wins[1] >= TO_WIN || this.round >= MAX_ROUNDS;
  }

  private finish(): MatchEvent[] {
    const [a, b] = this.wins;
    this.winner = a === b ? 2 : a > b ? 0 : 1;
    // A perfect: the deciding round won without a scratch.
    this.perfect = this.winner !== 2 && this.roundWinner === this.winner && this.perfect;
    this.go('result');
    return [{ k: 'result', winner: this.winner as 0 | 1 | 2, perfect: this.perfect }];
  }

  snapshot(): MatchSnap {
    return {
      id: this.id,
      sq: this.seq,
      ph: MATCH_PHASES.indexOf(this.phase),
      t: r2(this.t),
      r: this.round,
      w: [this.wins[0], this.wins[1]],
      tm: r2(this.timer),
      rw: this.roundWinner,
      win: this.winner,
      pf: this.perfect ? 1 : 0,
      ab: this.aborted ? 1 : 0,
      a: { id: this.a.id, n: this.a.name, hp: r2(this.hp[0]) },
      b: { id: this.b.id, n: this.b.name, hp: r2(this.hp[1]) },
      x: r2(this.x),
      z: r2(this.z),
    };
  }
}

/** A snapshot off the wire, checked (null if it isn't one). */
export function readSnap(d: unknown): MatchSnap | null {
  if (!d || typeof d !== 'object') return null;
  const s = d as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  const side = (v: unknown) => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.n !== 'string') return null;
    return { id: o.id.slice(0, 80), n: o.n.slice(0, 24), hp: num(o.hp, 0, 1) ?? 1 };
  };
  const a = side(s.a),
    b = side(s.b);
  const ph = num(s.ph, 0, MATCH_PHASES.length - 1);
  if (typeof s.id !== 'string' || !a || !b || ph === null || !Array.isArray(s.w)) return null;
  return {
    id: s.id.slice(0, 80),
    sq: num(s.sq, 0, 1e9) ?? 0,
    ph: Math.round(ph),
    t: num(s.t, 0, 600) ?? 0,
    r: Math.round(num(s.r, 1, MAX_ROUNDS) ?? 1),
    w: [Math.round(num(s.w[0], 0, 9) ?? 0), Math.round(num(s.w[1], 0, 9) ?? 0)],
    tm: num(s.tm, 0, ROUND_TIME) ?? ROUND_TIME,
    rw: Math.round(num(s.rw, -1, 2) ?? -1),
    win: Math.round(num(s.win, -1, 2) ?? -1),
    pf: s.pf ? 1 : 0,
    ab: s.ab ? 1 : 0,
    a,
    b,
    x: num(s.x, -1e4, 1e4) ?? 0,
    z: num(s.z, -1e4, 1e4) ?? 0,
  };
}

/**
 * A match followed from someone else's snapshots: the newest wins, and the
 * clocks run on between them (so the timer ticks and the banners time out
 * the same as on the machine running it).
 */
export class MatchView {
  snap: MatchSnap;
  /** Seconds since we last heard of it. */
  quiet = 0;

  constructor(s: MatchSnap) {
    this.snap = { ...s, w: [...s.w] as [number, number], a: { ...s.a }, b: { ...s.b } };
  }

  get phase(): MatchPhase {
    return MATCH_PHASES[this.snap.ph] ?? 'live';
  }

  /** Takes a newer snapshot. Returns true when the phase moved on. */
  apply(s: MatchSnap): boolean {
    this.quiet = 0;
    if (s.id !== this.snap.id || s.sq < this.snap.sq) return false;
    const moved = s.sq !== this.snap.sq;
    // Same phase: keep our clock unless it has drifted (no jitter from late packets).
    const t = !moved && Math.abs(s.t - this.snap.t) < 0.35 ? this.snap.t : s.t;
    const tm = !moved && Math.abs(s.tm - this.snap.tm) < 0.35 ? this.snap.tm : s.tm;
    this.snap = { ...s, t, tm, w: [...s.w] as [number, number], a: { ...s.a }, b: { ...s.b } };
    return moved;
  }

  update(dt: number) {
    this.quiet += dt;
    this.snap.t += dt;
    if (isLive(this.phase)) this.snap.tm = Math.max(0, this.snap.tm - dt);
  }

  get done() {
    return this.phase === 'over' && this.snap.t >= MT.over;
  }
}

/** One side of the power bars. */
export interface HudSide {
  name: string;
  /** Health 0..1. */
  hp: number;
  /** Rounds won. */
  wins: number;
  /** This side is you. */
  you: boolean;
}

export type BannerKind = 'vs' | 'round' | 'fight' | 'ko' | 'time' | 'win' | 'lose' | 'perfect' | 'draw' | 'over' | 'wins';

export interface HudState {
  /** How much of the HUD shows (it slams in and fades out), 0..1. */
  show: number;
  /** Seconds into the intro (the slam-in). */
  intro: number;
  left: HudSide;
  right: HudSide;
  round: number;
  final: boolean;
  /** Round clock (whole seconds). */
  timer: number;
  /** A big word in the middle, how far into it (s), and a smaller line under it. */
  banner: { text: string; sub: string; kind: BannerKind; t: number } | null;
  /** You're in it (not watching). */
  fighter: boolean;
}

/**
 * What the power bars show of a match, from where you stand: `me` is your
 * fighter id ('p:<your id>'), you're on the left if you're in it. `myHp`:
 * your own health, which you know better than the snapshot does.
 */
export function hudState(s: MatchSnap, me: string | null, myHp?: number): HudState {
  const ph = MATCH_PHASES[s.ph] ?? 'live';
  const flip = me !== null && s.b.id === me;
  const fighter = me !== null && (s.a.id === me || s.b.id === me);
  const mySide = flip ? 1 : 0;
  const side = (k: 0 | 1): HudSide => {
    const f = k === 0 ? s.a : s.b;
    const you = fighter && k === mySide;
    return { name: you ? 'YOU' : f.n.toUpperCase(), hp: you && myHp !== undefined && ph !== 'down' ? myHp : f.hp, wins: s.w[k], you };
  };
  const left = side(flip ? 1 : 0),
    right = side(flip ? 0 : 1);
  const final = isFinal(s.r, s.w);
  let banner: HudState['banner'] = null;
  const b = (text: string, kind: BannerKind, sub = '') => (banner = { text, sub, kind, t: s.t });
  const nameOf = (k: number) => (k === 0 ? s.a.n : s.b.n).toUpperCase();
  switch (ph) {
    case 'intro':
      b('VS', 'vs', `${left.name}  ·  ${right.name}`);
      break;
    case 'round':
      b(roundLabel(s.r, s.w), 'round');
      break;
    case 'fight':
      b('FIGHT!', 'fight');
      break;
    case 'ko':
      b('K.O.!', 'ko');
      break;
    case 'time':
      b('TIME!', 'time', s.rw === 2 ? 'EVEN ROUND' : `ROUND TO ${s.rw === mySide && fighter ? 'YOU' : nameOf(s.rw)}`);
      break;
    case 'result':
      if (s.win === 2) b('DRAW', 'draw');
      else if (fighter && s.win === mySide) s.pf ? b('PERFECT', 'perfect', 'YOU WIN') : b('YOU WIN', 'win');
      else if (fighter) b('YOU LOSE', 'lose');
      else s.pf ? b('PERFECT', 'perfect', `${nameOf(s.win)} WINS`) : b(`${nameOf(s.win)} WINS`, 'wins');
      break;
    case 'over':
      if (s.ab && s.t < MT.over) b('FIGHT OVER', 'over');
      break;
  }
  // In with the intro, out after the result (or the cut-short banner).
  const show = ph === 'intro' ? Math.min(1, s.t / 0.35) : ph === 'over' ? Math.max(0, 1 - Math.max(0, s.t - (s.ab ? MT.over - 0.6 : 0)) / 0.6) : 1;
  return { show, intro: ph === 'intro' ? s.t : 99, left, right, round: s.r, final, timer: Math.ceil(s.tm), banner, fighter };
}
