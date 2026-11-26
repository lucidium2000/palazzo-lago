/**
 * Wire format for piano notes between players: small batches of note-on,
 * note-off and pedal events, each a time offset (10 ms steps from the batch's
 * first event), a note and a velocity (0 = let go). Pedal changes ride as note
 * 0 (velocity 127 = down). Validated on the way in. Pure; unit tested.
 */

import { HIGH, LOW } from '../pianokeys';

export interface NoteEvent {
  /** Milliseconds (sender's clock) when it happened. */
  t: number;
  /** 0 for the pedal. */
  midi: number;
  /** 1..127, or 0 to let go (pedal: 127 down, 0 up). */
  vel: number;
}

/** At most this many events in one batch (a flurry beyond it is cut short). */
export const MAX_BATCH = 64;

/** Packs a batch: { n: [dt, midi, vel, dt, midi, vel, …] }. */
export function encodeNotes(evs: readonly NoteEvent[]): { n: number[] } {
  const n: number[] = [];
  if (!evs.length) return { n };
  const t0 = evs[0].t;
  for (let i = 0; i < evs.length && i < MAX_BATCH; i++) {
    const e = evs[i];
    n.push(Math.max(0, Math.min(255, Math.round((e.t - t0) / 10))), e.midi, Math.max(0, Math.min(127, Math.round(e.vel))));
  }
  return { n };
}

/** Unpacks a batch into offsets (seconds from its first event), notes and velocities; invalid entries are dropped. */
export function decodeNotes(d: unknown): { dt: number; midi: number; vel: number }[] {
  const out: { dt: number; midi: number; vel: number }[] = [];
  if (!d || typeof d !== 'object') return out;
  const n = (d as { n?: unknown }).n;
  if (!Array.isArray(n) || n.length > MAX_BATCH * 3) return out;
  for (let i = 0; i + 2 < n.length; i += 3) {
    const [dt, midi, vel] = [n[i], n[i + 1], n[i + 2]];
    if (!Number.isInteger(dt) || !Number.isInteger(midi) || !Number.isInteger(vel)) continue;
    if (dt < 0 || dt > 255 || vel < 0 || vel > 127) continue;
    if (midi !== 0 && (midi < LOW || midi > HIGH)) continue;
    out.push({ dt: dt / 100, midi, vel });
  }
  return out;
}
