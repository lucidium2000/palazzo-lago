import { copyMono, decodeAudio } from '../musicload';
import { CONCERT, entryMatches, indexPlan, songPlan, trackPlan, type SongPlan, type TrackName, type TrackPlan } from './setlist';
import type { RawTrack } from './song';
import type { SongMaps } from './songmaps';
import { analyse } from './songmapsload';
import { measureTrack } from './tempo';

/**
 * Fetching the party's music into what the decks' audio thread plays: mono
 * samples at 32 kHz from each track's first downbeat, whole bars long. A
 * record (deck A, deck B) gets a second of its start copied past its end, so
 * it loops on its bar line; the concert is its songs back to back.
 *
 * A file whose index.json entry no longer matches it (a song dropped in over
 * a placeholder without re-measuring: its length gives it away) is measured
 * here instead (tempo.ts), so a replacement is truly drop-in.
 *
 * Nothing is kept on the main thread: the samples are handed to the audio
 * thread, and each decoded file is dropped as soon as it's copied.
 */

/** Samples per second the party's tracks are kept at (mono). */
export const PARTY_RATE = 32000;

/** The plan for a decoded file: index.json's, or measured from the file if that doesn't match it. */
function planFor(name: TrackName, buf: AudioBuffer): TrackPlan {
  const known = entryMatches(name, buf.duration) ? indexPlan(name) : null;
  if (known) return known;
  const mono = new Float32Array(buf.length);
  copyMono(buf, 0, mono, 0);
  const m = measureTrack(mono, buf.sampleRate);
  console.info(`Party: ${name}.mp3 has no matching index.json entry; measured ${m.bpm} bpm, first downbeat ${m.firstBeat} s, ${m.bars} bars`);
  return trackPlan(name, { ...m, title: indexPlan(name)?.title });
}

/** A record for a deck: its plan and its samples (from the first downbeat, looping on its bars). */
export async function loadRecord(name: TrackName): Promise<{ plan: TrackPlan; raw: RawTrack }> {
  const buf = await decodeAudio(name, PARTY_RATE);
  const plan = planFor(name, buf);
  const n = Math.round(plan.length * PARTY_RATE);
  const data = new Float32Array(n + PARTY_RATE);
  copyMono(buf, plan.firstBeat, data, 0, n);
  // It loops: the second past the end is its start again.
  data.copyWithin(n, 0, PARTY_RATE);
  return { plan, raw: { data, sampleRate: PARTY_RATE, loop: plan.length } };
}

/**
 * The concert: each song's plan (its sections: index.json's, read from its
 * energy, or measured), and all of them back to back as one track (`raw`),
 * each from its first downbeat for its whole bars. One song decoded at a time.
 * Each song's maps (songmaps.ts: its vocal, drums, bass and keys) follow a
 * moment later, worked out in a worker from its mid and side channels.
 */
export async function loadConcert(): Promise<{ songs: SongPlan[]; raw: RawTrack; maps: Promise<SongMaps | null>[] }> {
  const songs: SongPlan[] = [];
  const parts: Float32Array<ArrayBuffer>[] = [];
  const maps: Promise<SongMaps | null>[] = [];
  for (const [i, name] of CONCERT.entries()) {
    let plan: SongPlan;
    let d: Float32Array<ArrayBuffer>;
    {
      const buf = await decodeAudio(name, PARTY_RATE);
      plan = songPlan(planFor(name, buf), i + 1);
      const n = Math.round(plan.length * PARTY_RATE);
      // (A second of silence past the end: the audio thread reads a sample ahead.)
      d = new Float32Array(n + (CONCERT.length === 1 ? PARTY_RATE : 0));
      copyMono(buf, plan.firstBeat, d, 0, n);
      maps.push(analyseSong(buf, plan, n));
    }
    songs.push(plan);
    parts.push(d);
  }
  if (parts.length === 1) return { songs, raw: { data: parts[0], sampleRate: PARTY_RATE, loop: songs[0].length }, maps };
  const total = parts.reduce((s, p) => s + p.length, 0);
  const data = new Float32Array(total + PARTY_RATE);
  let at = 0;
  for (const p of parts) {
    data.set(p, at);
    at += p.length;
  }
  return { songs, raw: { data, sampleRate: PARTY_RATE, loop: total / PARTY_RATE }, maps };
}

/** A song's maps: its mid (L+R)/2 and side (L-R)/2 from its first downbeat, to the worker. */
function analyseSong(buf: AudioBuffer, plan: SongPlan, n: number): Promise<SongMaps | null> {
  const s0 = Math.max(0, Math.round(plan.firstBeat * buf.sampleRate));
  const len = Math.max(0, Math.min(n, buf.length - s0));
  const mid = new Float32Array(len);
  let side: Float32Array | null = null;
  if (buf.numberOfChannels >= 2) {
    const L = buf.getChannelData(0).subarray(s0, s0 + len),
      R = buf.getChannelData(1).subarray(s0, s0 + len);
    side = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      mid[i] = (L[i] + R[i]) * 0.5;
      side[i] = (L[i] - R[i]) * 0.5;
    }
  } else mid.set(buf.getChannelData(0).subarray(s0, s0 + len));
  const info = { bpm: plan.bpm, sung: plan.info.map((b) => b.voice > 0), drops: plan.info.flatMap((b, i) => (b.drop ? [i] : [])) };
  return analyse(mid, side, buf.sampleRate, info).catch(() => null);
}
