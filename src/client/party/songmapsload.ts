import { SongAnalyser, type SongInfo, type SongMaps } from './songmaps';

/**
 * Runs a song's analysis (songmaps.ts) in a worker, so loading her set never
 * hitches a frame. Where a worker can't be had, it runs here in slices of a
 * few milliseconds, one slice per task.
 */
let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { ok: (m: SongMaps) => void; fail: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./songmaps.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; maps?: SongMaps; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.maps) w.ok(e.data.maps);
      else w.fail(new Error(e.data.error ?? 'song analysis failed'));
    };
    worker.onerror = (e) => {
      console.warn('Party: the song analysis worker failed; analysing on the main thread', e);
      worker?.terminate();
      worker = null;
      for (const [, w] of waiting) w.fail(new Error('worker failed'));
      waiting.clear();
    };
  } catch (e) {
    console.warn('Party: no worker for the song analysis', e);
    worker = null;
  }
  return worker;
}

async function sliced(mid: Float32Array, side: Float32Array | null, sr: number, info: SongInfo): Promise<SongMaps> {
  const a = new SongAnalyser(mid, side, sr, info);
  for (;;) {
    const t0 = performance.now();
    let done = false;
    while (!done && performance.now() - t0 < 4) done = a.step(16);
    if (done) break;
    await new Promise((r) => setTimeout(r, 8));
  }
  await new Promise((r) => setTimeout(r, 0));
  return a.finish();
}

/** The song's maps from its mid and side channels (both handed over: unusable here afterwards). */
export function analyse(mid: Float32Array, side: Float32Array | null, sr: number, info: SongInfo): Promise<SongMaps> {
  const w = getWorker();
  if (!w) return sliced(mid, side, sr, info);
  const id = nextId++;
  return new Promise<SongMaps>((ok, fail) => {
    waiting.set(id, { ok, fail });
    const transfer: Transferable[] = [mid.buffer as ArrayBuffer];
    if (side) transfer.push(side.buffer as ArrayBuffer);
    w.postMessage({ id, mid, side, sr, info: { bpm: info.bpm, sung: info.sung ? Array.from(info.sung) : undefined, drops: info.drops ? Array.from(info.drops) : undefined } }, transfer);
  }).catch((e) => {
    // The worker died with our samples (already handed over): nothing to analyse here.
    console.warn('Party: song analysis failed', e);
    throw e;
  });
}
