/**
 * Measures music tracks for public/audio/index.json without librosa (the same
 * measurements party/music.ts makes in the browser when a song has no entry):
 * tempo, first downbeat and per-bar energy.
 *
 *   npx tsx scripts/measure-music.ts deck_a deck_b      (prints the entries)
 *   npx tsx scripts/measure-music.ts --write deck_a     (writes them into index.json, keeping other fields)
 *
 * Needs ffmpeg on PATH (decodes to mono 22.05 kHz).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureTrack } from '../src/client/party/tempo';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const names = args.filter((a) => !a.startsWith('--'));
const indexPath = join(root, 'public', 'audio', 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const SR = 22050;
for (const name of names) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(root, 'public', 'audio', `${name}.mp3`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const m = measureTrack(x, SR);
  const known = index[name];
  console.log(name, { bpm: m.bpm, firstBeat: m.firstBeat, bars: m.bars, seconds: m.seconds }, known ? { indexBpm: known.bpm, indexFirstBeat: known.firstBeat, indexBars: known.bars } : '(no entry)');
  if (write) index[name] = { ...(known ?? { kind: 'music' }), ...m };
}
if (write) writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
