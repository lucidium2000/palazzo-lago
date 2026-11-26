/**
 * Fetching and decoding the game's music and sound effects (public/audio/).
 *
 * Everything is decoded on an OfflineAudioContext at the rate we want to keep
 * it at (decodeAudioData resamples to its context's rate), so a 2-minute
 * track is never held at 48 kHz: the party's tracks are kept as mono 32 kHz
 * samples (~16 MB for the DJ's 126 s), the casino's lounge track as stereo
 * 32 kHz (~30 MB), the short effects at 24 kHz.
 */

export const audioUrl = (name: string) => new URL(`audio/${name}.mp3`, document.baseURI).href;

/** The encoded file (an mp3): rejects on a network error or a bad status. */
export async function fetchAudio(name: string): Promise<ArrayBuffer> {
  const r = await fetch(audioUrl(name));
  if (!r.ok) throw new Error(`audio/${name}.mp3: ${r.status}`);
  const type = r.headers.get('content-type') ?? '';
  if (type.includes('text/html')) throw new Error(`audio/${name}.mp3: not served`);
  return r.arrayBuffer();
}

/** Fetches and decodes a file at `sampleRate` (its own channel count). */
export async function decodeAudio(name: string, sampleRate: number): Promise<AudioBuffer> {
  const bytes = await fetchAudio(name);
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  return ctx.decodeAudioData(bytes);
}

/**
 * Copies `buf` (mixed down to mono) from `from` seconds into `into` at sample
 * `at`, at most `max` samples (stops at the end of either).
 */
export function copyMono(buf: AudioBuffer, from: number, into: Float32Array, at: number, max = Infinity) {
  const s0 = Math.max(0, Math.round(from * buf.sampleRate));
  const n = Math.max(0, Math.min(max, buf.length - s0, into.length - at));
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    if (chs === 1) {
      into.set(d.subarray(s0, s0 + n), at);
      break;
    }
    const k = 1 / chs;
    for (let i = 0; i < n; i++) into[at + i] += d[s0 + i] * k;
  }
  return n;
}
