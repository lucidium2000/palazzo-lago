/** Renders the piano's notes off the main thread (see pianotone.ts). */
import { renderTone } from './pianotone';

self.onmessage = (e: MessageEvent<{ midi: number; rate: number }>) => {
  const { midi, rate } = e.data;
  const buf = renderTone(midi, rate);
  (self as unknown as Worker).postMessage({ midi, buf }, [buf.buffer]);
};
