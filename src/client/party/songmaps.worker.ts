import { analyseSong, mapBuffers, type SongInfo } from './songmaps';

/** The song analysis off the main thread (songmaps.ts): samples in, maps out (both handed over, not copied). */
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = (e: MessageEvent<{ id: number; mid: Float32Array; side: Float32Array | null; sr: number; info: SongInfo }>) => {
  const { id, mid, side, sr, info } = e.data;
  try {
    const maps = analyseSong(mid, side, sr, info);
    ctx.postMessage({ id, maps }, mapBuffers(maps));
  } catch (err) {
    ctx.postMessage({ id, error: String(err) }, []);
  }
};
