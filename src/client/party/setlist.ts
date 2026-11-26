import INDEX from '../../../public/audio/index.json';
import { arrangement, detectSections, songSections, type Arrangement, type BarInfo, type MeasuredTrack } from './beat';

/**
 * The music as measured (public/audio/index.json) and the pool party's set
 * list built from it: the DJ's 64 bars (dj_set.mp3), then the headliner's
 * two 32-bar songs (orlo_*.mp3), round and round on the wall clock so
 * everyone in a room hears the same bar at the same time.
 *
 * Pure (no audio): the arrangements are unit-tested in tests/beat.test.ts.
 */

export type TrackName = 'dj_set' | 'orlo_neon_on_the_water' | 'orlo_last_call_heart' | 'casino_lounge' | 'jackpot' | 'cheer' | 'applause' | 'floor_loop';

export const TRACKS = INDEX as unknown as Record<TrackName, MeasuredTrack & { kind: string; loop?: boolean }>;

export const DJ_TRACK = TRACKS.dj_set;
/** The headliner's songs, in the order he sings them. */
export const SONG_TRACKS: { name: TrackName; title: string; track: MeasuredTrack }[] = [
  { name: 'orlo_neon_on_the_water', title: 'Neon on the Water', track: TRACKS.orlo_neon_on_the_water },
  { name: 'orlo_last_call_heart', title: 'Last Call Heart', track: TRACKS.orlo_last_call_heart },
];

/** The set's one tempo (the DJ's, as measured: the songs are within 0.005% of it). */
export const SET_BPM = DJ_TRACK.bpm;
/** Bars in a slot of the set list (the DJ's set; the headliner's two songs back to back). */
export const SLOT_BARS = DJ_TRACK.bars;
/** Bars in one of his songs. */
export const SONG_BARS = SLOT_BARS / SONG_TRACKS.length;

export const DJ_BARS: BarInfo[] = detectSections(DJ_TRACK.perBar, true, 0);
export const SONG_SECTIONS: BarInfo[][] = SONG_TRACKS.map((s, i) => songSections(s.track.perBar, s.track.sections ?? [{ name: 'chorus', bar: 0, bars: s.track.bars, sung: true }], i + 1));

/** The set while only the DJ's track is loaded (he plays both slots). */
export const DJ_ONLY: Arrangement = arrangement(SET_BPM, DJ_BARS, DJ_BARS);
/** The full set list: the DJ, then the headliner. */
export const FULL_SET: Arrangement = arrangement(SET_BPM, DJ_BARS, ...SONG_SECTIONS);

/** Where a track's audio sits in its slot: decoded from `firstBeat`, beat 0 of the slot lands at `at` seconds. */
export function slotLayout(bpm = SET_BPM) {
  const bar = (60 / bpm) * 4;
  return {
    slot: SLOT_BARS * bar,
    dj: { name: 'dj_set' as TrackName, firstBeat: DJ_TRACK.firstBeat, at: 0 },
    songs: SONG_TRACKS.map((s, i) => ({ name: s.name, firstBeat: s.track.firstBeat, at: i * SONG_BARS * bar, length: SONG_BARS * bar })),
  };
}
