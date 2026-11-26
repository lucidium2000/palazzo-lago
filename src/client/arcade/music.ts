/**
 * Writing chiptunes by hand: notes as names ("C5 . E5 - G5"), parsed once
 * into MIDI numbers for the song format in types.ts. Every tune in the
 * arcade is written for it (all original).
 */

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** One note name to MIDI ("C4" = 60, "F#3", "Bb5"). */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** "C5 . E5 - G5 …": a note per step, '.' rest (0), '-' hold (-1). */
export function notes(s: string): number[] {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => (t === '.' ? 0 : t === '-' ? -1 : midi(t)));
}

/** Hz from a MIDI number. */
export function hz(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}
