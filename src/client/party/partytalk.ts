import { CONCERT, CREW_PARTY, GAMBLING, NIXIE, type ConcertSet, type PartyPhase, type PartyReact } from './concertlines';

/**
 * Who may say what at the pool party (pure: no three.js, no audio; the tests
 * check it, dialogue.ts and crew.ts follow it).
 *
 * - The performers: the DJ and her band never chat (they're working); she says
 *   nothing at all while she's on (from her walk-on to the end of her set: no
 *   line, no robot voice, not even a gasp), only reacts with her body (a
 *   glance, a recoil) and keeps singing. Between sets she talks, about the show.
 * - Everyone else out on the deck talks about the party and the show, never
 *   the casino's games (concertlines.ts: GAMBLING), in their own voice, and
 *   only from a recording: a line without its take yet is a speech bubble and,
 *   for a shout, a wordless whoop.
 */

export interface Speaker {
  performer: 'singer' | 'band' | 'dj' | null;
  hush: boolean;
}

/** Not a word from them right now (no line, no stand-in voice, no gasp). */
export function silent(p: Speaker): boolean {
  return p.performer !== null && (p.performer !== 'singer' || p.hush);
}

/** She's on stage: from two bars before her set (she walks on) to its end. */
export function onStage(o: { ready: boolean; live: boolean; toLive: number; bar: number }): boolean {
  return o.ready && (o.live || o.toLive <= 2 * o.bar);
}

/** Her set is this close (s) when the DJ calls her ("in one minute"), unless told (`called`). */
export const CALLED_BEFORE = 75;

/**
 * Where the night is: her set coming up (the DJ's called her: "one minute!"),
 * on, just over (or between songs), or the DJ's stretch.
 */
export function phaseAt(o: { live: boolean; song: number; toLive: number; sinceEnd: number; called?: boolean }): PartyPhase {
  if (o.live) return o.song >= 0 ? 'live' : 'after';
  if (o.sinceEnd < 75) return 'after';
  if (o.called ?? o.toLive < CALLED_BEFORE) return 'soon';
  return 'dj';
}

/** The party as the dialogue sees it. */
export interface PartyTalk {
  phase(): PartyPhase;
  /** Is this spot at the party (the pool deck)? */
  at(x: number, z: number): boolean;
}

export const partySafe = (text: string) => !GAMBLING.test(text);

/** A regular's lines at the party (null: no set for them). */
export function concertSet(id: string): ConcertSet | null {
  return CONCERT[id] ?? null;
}

/** What they say among themselves at this moment of the night. */
export function chatterPool(id: string, phase: PartyPhase): string[] {
  const s = CONCERT[id];
  if (!s) return [];
  // Before her set and between songs there's still the odd word about the DJ and the lights; once
  // the DJ's called her, it's all "one minute!" (and the odd "is she on yet?").
  return phase === 'live' ? s.live : phase === 'dj' ? [...s.dj, ...s.soon.slice(0, 1)] : phase === 'soon' ? [...s.minute, ...s.minute, ...s.soon] : s[phase];
}

/**
 * What someone at the party says when you get physical with them: their party
 * lines first (those with a take, `has`), else their usual ones that aren't
 * about the casino's games, else nothing (a gasp).
 */
export function partyReactions(own: string[] | undefined, usual: string[] | undefined, has: (t: string) => boolean): string[] {
  const mine = (own ?? []).filter(has);
  if (mine.length) return mine;
  return (usual ?? []).filter((t) => partySafe(t) && has(t));
}

/** Her lines between sets (id 'nixie'). */
export function nixieReact(kind: PartyReact): string[] {
  return NIXIE.react[kind];
}

/** Your crew's line for an idle moment at the party. */
export function crewPartyLines(phase: PartyPhase): string[] {
  return CREW_PARTY[phase];
}

/** How often (s, mean) someone in the crowd near you shouts or says something, by the moment. */
export function chatterGap(phase: PartyPhase): number {
  return phase === 'live' ? 2.2 : phase === 'soon' ? 3.5 : phase === 'after' ? 3 : 9;
}

/** Of the crowd's shouts, how many are a wordless whoop rather than words (live: mostly). */
export function whoopShare(phase: PartyPhase): number {
  return phase === 'live' ? 0.6 : phase === 'after' ? 0.45 : phase === 'soon' ? 0.3 : 0.1;
}
