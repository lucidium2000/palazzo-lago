import * as THREE from 'three';
import type { Sound } from '../audio';
import { voices } from '../voices';
import { elVoice } from '../cast';
import { PLAYER_STANDIN, PLAYER_VOICES } from '../reactlines';
import { FightHud } from './fighthud';
import { FightMusic, type MusicOut } from './fightmusic';
import { ANNOUNCER, ANNOUNCER_ID, ANNOUNCER_NAMES, PLAYER_FIGHT, announcerWins, roundCall, type FightMoment } from './fightlines';
import { MATCH_PHASES, Match, MatchView, hudState, isFinal, isLive, readSnap, type FighterInfo, type MatchEvent, type MatchPhase, type MatchSnap } from './rounds';

/**
 * Fight mode: the arcade-style versus presentation around a fight (see
 * rounds.ts for the match itself). It runs the match for a fight that's
 * yours to run, follows the ones friends run, and for the one that matters
 * to you (yours, or the nearest one you're watching) puts on the show: the
 * power bars and the calls (fighthud.ts), the announcer (a recorded take, or
 * a synthesized sting and the banner until it's in), Ring of Steel on the
 * music bus (fightmusic.ts), your own voice, and the slow-motion beat on a
 * knockout and the hit-stop on big hits (visual only: `timeScale` slows the
 * people, never your head tracking).
 *
 * Network: the machine running a match puts its snapshot in its published
 * state (`fm`) and sends it as an event (`fmx`) on every phase change, so the
 * calls land on time everywhere; the newest wins.
 */

export interface Side {
  /** Health left 0..1. */
  hp(): number;
  /** Knocked out right now. */
  down(): boolean;
  /** On their feet and ready (not out, not still getting up). */
  up(): boolean;
}

export interface ModeDeps {
  sound: Sound;
  camera: THREE.Camera;
  scene: THREE.Scene;
  inXR(): boolean;
  feet(): THREE.Vector3;
  /** Your id in the room (null: not in one). */
  selfId(): string | null;
  /** Sends a room event (nothing when not in a room). */
  emit(k: string, d: unknown): void;
  playerFemale(): boolean;
  /** The music bus's way out (null: no audio yet). */
  music(): MusicOut | null;
  /** Your health 0..1 (you know it better than any snapshot). */
  myHp(): number;
}

interface Hosted {
  m: Match;
  sides: [Side, Side];
  center: () => { x: number; z: number };
  onEvent: (e: MatchEvent) => void;
  sent: number;
}

/** What the presentation is showing (for tests and the debug console). */
export interface ModeShow {
  id: string;
  phase: MatchPhase;
  fighter: boolean;
  round: number;
}

export const WATCH_RANGE = 15;

export class FightMode {
  readonly hud: FightHud;
  readonly music: FightMusic;
  private hosted: Hosted | null = null;
  private views = new Map<string, MatchView>();
  private n = 0;
  private shownKey = '';
  private slowT = 0;
  private stopT = 0;
  private lastMine = -99;
  private time = 0;
  /** What's on show (null: nothing). */
  show: ModeShow | null = null;
  /** A call happened in the match you're watching or in (Fights: the crowd and the fighters' lines). */
  onCall: ((k: MatchPhase, s: MatchSnap, fighter: boolean) => void) | null = null;
  /** Announcer lines said (or captioned) so far, newest last (tests). */
  readonly called: string[] = [];

  constructor(private d: ModeDeps) {
    this.hud = new FightHud(d.scene, d.camera);
    this.music = new FightMusic(d.music);
  }

  /** Your fighter id. */
  me(): string {
    return 'p:' + (this.d.selfId() ?? 'me');
  }

  /** Starts a match you run. Returns it (null if you're already running one). */
  host(a: FighterInfo, b: FighterInfo, sides: [Side, Side], center: () => { x: number; z: number }, onEvent: (e: MatchEvent) => void): Match | null {
    if (this.hosted && !this.hosted.m.done) return null;
    const m = new Match(`${this.d.selfId() ?? 'me'}:${++this.n}:${Math.floor(Math.random() * 1e4)}`, a, b);
    const c = center();
    m.x = c.x;
    m.z = c.z;
    this.hosted = { m, sides, center, onEvent, sent: 0 };
    this.music.preload();
    this.send();
    return m;
  }

  get hostedMatch(): Match | null {
    return this.hosted?.m ?? null;
  }

  /** Ends the match you run (FIGHT OVER), if it's still going. */
  abortHosted() {
    const h = this.hosted;
    if (!h) return;
    for (const e of h.m.abort()) h.onEvent(e);
    this.send();
  }

  /** A match a friend runs (their `fmx`, or `fm` in their state). */
  onSnap(data: unknown) {
    const s = readSnap(data);
    if (!s) return;
    if (this.hosted && s.id === this.hosted.m.id) return;
    const v = this.views.get(s.id);
    if (v) v.apply(s);
    else if (MATCH_PHASES[s.ph] !== 'over' || s.ab) this.views.set(s.id, new MatchView(s));
  }

  /** For your published state. */
  snapshot(): MatchSnap | null {
    const h = this.hosted;
    return h && !h.m.done ? h.m.snapshot() : null;
  }

  private send() {
    const h = this.hosted;
    if (!h || h.sent === h.m.seq) return;
    h.sent = h.m.seq;
    this.d.emit('fmx', h.m.snapshot());
  }

  /** The match you're in (yours or a friend's), as it stands. */
  mine(): MatchSnap | null {
    const me = this.me();
    if (this.hosted && !this.hosted.m.done) return this.hosted.m.snapshot();
    for (const v of this.views.values()) if (!v.done && (v.snap.a.id === me || v.snap.b.id === me)) return v.snap;
    return null;
  }

  /** Punches between you and this friend count right now (false between rounds, before the bell). */
  gate(friendId: string): boolean {
    const s = this.mine();
    if (!s) return true;
    const them = 'p:' + friendId;
    if (s.a.id !== them && s.b.id !== them) return true;
    return isLive(MATCH_PHASES[s.ph] ?? 'live');
  }

  /** Is there a match (on, not finished) between you and this friend? */
  versus(friendId: string): boolean {
    const s = this.mine();
    const them = 'p:' + friendId;
    return !!s && (s.a.id === them || s.b.id === them) && MATCH_PHASES[s.ph] !== 'over' && MATCH_PHASES[s.ph] !== 'result';
  }

  /** Any match involving this fighter id that's still on (theirs or yours). */
  busy(id: string): boolean {
    const on = (s: MatchSnap) => (s.a.id === id || s.b.id === id) && MATCH_PHASES[s.ph] !== 'over';
    if (this.hosted && !this.hosted.m.done && on(this.hosted.m.snapshot())) return true;
    for (const v of this.views.values()) if (on(v.snap)) return true;
    return false;
  }

  /** The people's clock (the slow-motion beat, the hit-stop). Never your view. */
  get timeScale(): number {
    if (this.stopT > 0) return 0.04;
    if (this.slowT > 0) return this.slowT > 0.35 ? 0.28 : 0.28 + (1 - 0.28) * (1 - this.slowT / 0.35);
    return 1;
  }

  /** A big hit: freeze the fighters for a couple of frames, shake the bars, a rumble in your hands. */
  impact(k: number) {
    if (k >= 0.65) this.stopT = Math.max(this.stopT, 0.045 + 0.03 * Math.min(1, k - 0.65));
    this.hud.shake(0.3 + 0.7 * k);
  }

  /** The world's music level multiplier (Ring of Steel ducks it). */
  get duck() {
    return this.music.duck;
  }

  update(dt: number) {
    this.time += dt;
    this.stopT = Math.max(0, this.stopT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    const h = this.hosted;
    if (h) {
      const [a, b] = h.sides;
      const c = h.center();
      h.m.x = c.x;
      h.m.z = c.z;
      for (const e of h.m.update(dt, { hp: [a.hp(), b.hp()], down: [a.down(), b.down()], up: [a.up(), b.up()] })) h.onEvent(e);
      this.send();
      if (h.m.done) this.hosted = null;
    }
    for (const [id, v] of this.views) {
      v.update(dt);
      if (v.done || (v.quiet > 6 && v.phase !== 'over')) this.views.delete(id);
    }
    // What's on show: yours, else the nearest you're watching.
    const me = this.me();
    const feet = this.d.feet();
    let focus: MatchSnap | null = this.hosted ? this.hosted.m.snapshot() : null;
    let best = WATCH_RANGE;
    if (!focus)
      for (const v of this.views.values()) {
        const s = v.snap;
        if (s.a.id === me || s.b.id === me) {
          focus = s;
          break;
        }
        const dd = Math.hypot(s.x - feet.x, s.z - feet.z);
        if (dd < best) {
          best = dd;
          focus = s;
        }
      }
    const fighter = !!focus && (focus.a.id === me || focus.b.id === me);
    if (focus) this.present(focus, fighter);
    else this.show = null;
    const ph = focus ? MATCH_PHASES[focus.ph] : null;
    const dist = focus ? Math.hypot(focus.x - feet.x, focus.z - feet.z) : 0;
    this.music.update(dt, !!focus && ph !== 'over', fighter ? 'fighter' : 'spectator', dist);
    const hs = focus && (fighter || dist < WATCH_RANGE) ? hudState(focus, fighter ? me : null, fighter ? this.d.myHp() : undefined) : null;
    this.hud.update(dt, hs, this.d.inXR());
  }

  /** The calls: announcer, stings, music cues, slow motion, on each new phase of the match on show. */
  private present(s: MatchSnap, fighter: boolean) {
    const ph = MATCH_PHASES[s.ph] ?? 'live';
    this.show = { id: s.id, phase: ph, fighter, round: s.r };
    const key = `${s.id}|${s.r}|${ph}`;
    if (key === this.shownKey) return;
    const first = !this.shownKey.startsWith(s.id + '|');
    this.shownKey = key;
    // Joined late (watching): no calls for what's long past.
    if (first && s.t > 2.5 && ph !== 'intro') return;
    const vol = fighter ? 1 : 0.55;
    const sting = (n: 'stingRound' | 'stingFight' | 'stingKO' | 'stingWin' | 'stingOver' | 'ringBell', v = 1) => this.d.sound.playLocal(n as never, v * vol);
    const say = (text: string) => this.announce(text, vol);
    switch (ph) {
      case 'intro':
        this.d.sound.playLocal('whoosh', 0.8 * vol, 0.7);
        this.d.sound.playLocal('thunk', 0.9 * vol, 0.6);
        if (fighter) this.mine_('taunt', 0.9);
        break;
      case 'round':
        sting('stingRound', 0.55);
        say(roundCall(s.r, isFinal(s.r, s.w)));
        break;
      case 'fight':
        sting('stingFight', 0.6);
        sting('ringBell', 0.35);
        say(ANNOUNCER.fight);
        break;
      case 'ko':
        sting('stingKO', 0.7);
        say(ANNOUNCER.ko);
        this.slowT = 1.25;
        break;
      case 'time':
        sting('ringBell', 0.45);
        say(ANNOUNCER.time);
        break;
      case 'result': {
        const mySide = s.a.id === this.me() ? 0 : 1;
        if (s.win === 2) {
          sting('stingOver', 0.5);
          say(ANNOUNCER.draw);
        } else if (fighter) {
          const won = s.win === mySide;
          sting(won ? 'stingWin' : 'stingOver', 0.6);
          say(won ? (s.pf ? ANNOUNCER.perfect : ANNOUNCER.youWin) : ANNOUNCER.youLose);
          this.mine_(won ? 'win' : 'lose', 1.6);
        } else {
          sting('stingWin', 0.5);
          const name = (s.win === 0 ? s.a.n : s.b.n).trim();
          const known = ANNOUNCER_NAMES.find((n) => n.toLowerCase() === name.toLowerCase());
          say(s.pf ? ANNOUNCER.perfect : known ? announcerWins(known) : ANNOUNCER.winner);
        }
        break;
      }
      case 'over':
        if (s.ab) {
          sting('stingOver', 0.5);
          say(ANNOUNCER.over);
        }
        break;
    }
    this.onCall?.(ph, s, fighter);
  }

  /** The announcer: his recorded take if it's in (else the banner is the caption and the sting does the job). */
  private announce(text: string, vol: number) {
    this.called.push(text);
    if (this.called.length > 40) this.called.shift();
    voices.talk({ who: 'Announcer', text, voice: elVoice(ANNOUNCER_ID), at: null, volume: 1.2 * vol, priority: true, group: 'announcer', recordedOnly: true, captionFallback: false });
  }

  /** You, out loud (your voice's take; else a caption for words, a grunt for effort). `delay`: seconds. */
  say(moment: FightMoment, delay = 0) {
    this.mine_(moment, delay);
  }

  private mine_(moment: FightMoment, delay = 0) {
    if (this.time - this.lastMine < (moment === 'land' || moment === 'hurt' ? 3.5 : 1.5)) return;
    this.lastMine = this.time;
    const fem = this.d.playerFemale();
    const id = fem ? PLAYER_VOICES.female : PLAYER_VOICES.male;
    const pool = PLAYER_FIGHT[id]?.[moment] ?? [];
    const text = pool[Math.floor(Math.random() * pool.length)];
    if (!text) return;
    const go = () => {
      const voice = elVoice(id);
      const alt = fem ? PLAYER_STANDIN.female : PLAYER_STANDIN.male;
      const effort = moment === 'land' || moment === 'hurt';
      if (!voices.has(voice, text) && !voices.has(alt, text) && effort) {
        this.d.sound.playLocal((moment === 'hurt' ? 'oof' : 'grunt') as never, 0.35, fem ? 1.45 : 1);
        return;
      }
      voices.talk({ who: 'You', text, voice, alt, at: null, volume: 0.75, group: 'me', recordedOnly: true, captionFallback: !effort });
    };
    if (delay > 0) setTimeout(go, delay * 1000);
    else go();
  }

  /** For tests and the debug console. */
  debug() {
    return { hosted: this.hosted?.m.snapshot() ?? null, views: [...this.views.values()].map((v) => v.snap), show: this.show, music: { level: this.music.cue.level, playing: this.music.playing, duck: this.duck }, hud: this.hud.last };
  }

  dispose() {
    this.hud.dispose();
    this.music.dispose();
  }
}
