import INDEX from '../../../public/audio/index.json';
import { arrangement, detectSections, songSections, type Arrangement, type BarInfo, type BarLevels, type MeasuredTrack } from './beat';

/**
 * The pool party's music as measured (public/audio/index.json) and what's
 * made of it:
 *
 * - The decks: deck A (deck_a.mp3, the left record) is the house music, the
 *   resident DJ's set, with the crossfader resting full left; deck B
 *   (deck_b.mp3, the right record) comes in when someone at the decks fades
 *   right. Both loop on their own bar lines.
 * - The concert: the headliner's song(s) (concert_1.mp3; CONCERT lists them),
 *   each followed by its own sections (verse, pre-chorus, chorus) at its own
 *   tempo. A song with no section map gets one read from its energy
 *   (autoSections); a song with no index.json entry at all (or one that no
 *   longer matches the file) is measured in the browser (tempo.ts).
 * - dj_set.mp3 stands in for deck A if that can't be had.
 *
 * Pure (no audio): tests/beat.test.ts, tests/scratch.test.ts.
 */

export type TrackName = 'dj_set' | 'deck_a' | 'deck_b' | 'concert_1' | 'concert_2' | 'casino_lounge' | 'jackpot' | 'cheer' | 'applause' | 'floor_loop';

export interface IndexEntry extends Partial<MeasuredTrack> {
  kind: string;
  title?: string;
  loop?: boolean;
  seconds?: number;
}

export const TRACKS = INDEX as unknown as Record<TrackName, IndexEntry>;

const isMeasured = (e: IndexEntry | undefined): e is IndexEntry & MeasuredTrack => !!e && Number.isFinite(e.bpm) && Number.isFinite(e.firstBeat) && Number.isFinite(e.bars) && Array.isArray(e.perBar) && e.perBar.length > 0;

/** A track ready to play on the beat: its tempo, where its first downbeat is, how many whole bars. */
export interface TrackPlan {
  name: TrackName;
  title: string;
  bpm: number;
  firstBeat: number;
  bars: number;
  /** One bar (s), and the whole bars from the first downbeat (s). */
  bar: number;
  length: number;
  perBar: BarLevels[];
  sections?: MeasuredTrack['sections'];
}

/** A plan from a measured track (an index.json entry, or tempo.ts's measurement of the file). */
export function trackPlan(name: TrackName, m: MeasuredTrack & { title?: string }): TrackPlan {
  const bar = 240 / m.bpm;
  const bars = Math.max(1, Math.round(m.bars));
  return { name, title: m.title ?? name, bpm: m.bpm, firstBeat: m.firstBeat, bars, bar, length: bars * bar, perBar: m.perBar.slice(0, bars), sections: m.sections };
}

/** index.json's plan for a track, if it has a measured entry. */
export function indexPlan(name: TrackName): TrackPlan | null {
  const e = TRACKS[name];
  return isMeasured(e) ? trackPlan(name, { ...e, title: e.title }) : null;
}

/**
 * Does index.json's entry still describe the file? (A song dropped in over a
 * placeholder without re-measuring: its length gives it away.)
 */
export function entryMatches(name: TrackName, decodedSeconds: number): boolean {
  const e = TRACKS[name];
  return isMeasured(e) && Number.isFinite(e.seconds) && Math.abs((e.seconds ?? 0) - decodedSeconds) < 0.75;
}

// --- The decks -----------------------------------------------------------------------

/** The house record (deck A), as index.json has it; dj_set if deck A isn't measured. */
export const HOUSE_PLAN: TrackPlan = indexPlan('deck_a') ?? indexPlan('dj_set')!;
export const DECK_B_PLAN: TrackPlan | null = indexPlan('deck_b');

/** A deck record's bars as the beat clock reads them (drops, breakdowns, builds from its energy). */
export function deckArrangement(p: TrackPlan): Arrangement {
  return arrangement(p.bpm, detectSections(p.perBar, true, 0));
}

/** The DJ's set (deck A, the house record) as the beat clock reads it. */
export const DJ_SET: Arrangement = deckArrangement(HOUSE_PLAN);

/**
 * Deck B's playback rate to stay in time with deck A when they're blended:
 * their tempos' ratio when it's within a turntable's pitch range (±8 %, after
 * halving or doubling), else 1 (deck B keeps its own tempo and starts on deck
 * A's bar line instead).
 */
export function beatMatch(bpmA: number, bpmB: number, range = 0.08): number {
  if (!(bpmA > 0 && bpmB > 0)) return 1;
  let r = bpmA / bpmB;
  while (r > Math.SQRT2) r /= 2;
  while (r < Math.SQRT1_2) r *= 2;
  return Math.abs(r - 1) <= range ? r : 1;
}

// --- The concert ----------------------------------------------------------------------

/**
 * The headliner's set, in the order she sings it (drop-in replaceable files:
 * add 'concert_2' here, with its file and index.json entry, for a second song).
 */
export const CONCERT: TrackName[] = ['concert_1'];

/**
 * Sections for a song with no section map, from its bars' energy: the loudest
 * four-bar phrases are the chorus, the phrase before a chorus its pre-chorus,
 * the rest verse (and quiet bars at the end its outro: songSections). With no
 * energy to go on, time: verse for the first quarter, a pre-chorus phrase,
 * then chorus.
 */
export function autoSections(per: BarLevels[] | undefined, bars: number): NonNullable<MeasuredTrack['sections']> {
  const n = Math.max(1, bars);
  const parts: string[] = new Array(n).fill('verse');
  const phrases = Math.ceil(n / 4);
  if (per && per.length >= n && n >= 8) {
    const avg = Array.from({ length: phrases }, (_, k) => {
      const xs = per.slice(k * 4, Math.min(n, k * 4 + 4)).map((p) => p.level);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    });
    const sorted = [...avg].sort((a, b) => b - a);
    const hi = sorted[0];
    // Within ~2 dB of the loudest phrase, and in the loudest ~45 %.
    const cut = Math.max(hi - 2, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.45))]);
    for (let k = 0; k < phrases; k++) if (avg[k] >= cut - 1e-9 && k > 0) for (let i = k * 4; i < Math.min(n, k * 4 + 4); i++) parts[i] = 'chorus';
  }
  if (!parts.includes('chorus')) {
    // Time-based: verse for a quarter (whole phrases), a pre-chorus phrase, then chorus.
    const v = Math.max(4, Math.round(n / 16) * 4);
    for (let i = Math.min(n, v + 4); i < n; i++) parts[i] = 'chorus';
  }
  // The phrase before each chorus (if it isn't one) builds into it.
  for (let i = 4; i < n; i++) if (parts[i] === 'chorus' && parts[i - 1] === 'verse') for (let k = i - 4; k < i; k++) if (parts[k] === 'verse') parts[k] = 'pre-chorus';
  const out: NonNullable<MeasuredTrack['sections']> = [];
  for (let i = 0; i < n; i++) {
    const last = out[out.length - 1];
    if (last && last.name === parts[i]) last.bars++;
    else out.push({ name: parts[i], bar: i, bars: 1, sung: true });
  }
  return out;
}

/** A concert song ready to perform: its plan, its bars (sections), its arrangement. */
export interface SongPlan extends TrackPlan {
  info: BarInfo[];
  arr: Arrangement;
}

/** A song's sections and arrangement (`track`: 1, 2: which of his songs). */
export function songPlan(p: TrackPlan, track: number): SongPlan {
  const sections = p.sections && p.sections.length ? p.sections : autoSections(p.perBar, p.bars);
  const per = p.perBar.length >= p.bars ? p.perBar : Array.from({ length: p.bars }, (_, i) => p.perBar[i] ?? { drums: -14, tonal: -20, level: -12 });
  const info = songSections(per, sections, track);
  return { ...p, sections, info, arr: arrangement(p.bpm, info) };
}

/** The songs as index.json has them (before the files are fetched, or if they match it). */
export const INDEX_SONGS: (SongPlan | null)[] = CONCERT.map((n, i) => {
  const p = indexPlan(n);
  return p ? songPlan(p, i + 1) : null;
});

/** His set's music (s): each song from its first downbeat, its whole bars, back to back. */
export function concertLength(songs: (SongPlan | null)[]): number {
  return songs.reduce((s, p) => s + (p ? p.length : 0), 0);
}

/** Which song (and how far into it, s) at `into` seconds into his set; -1 past the music. */
export function songAt(songs: (SongPlan | null)[], into: number): { song: number; t: number } {
  let t = into;
  for (let i = 0; i < songs.length; i++) {
    const p = songs[i];
    if (!p) continue;
    if (t < p.length) return { song: i, t };
    t -= p.length;
  }
  return { song: -1, t };
}
