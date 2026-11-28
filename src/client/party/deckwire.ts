/**
 * Your decks on the wire (`dk` in your state while you're at them): the
 * faders, where each record is, and the platters (so friends hear your mix,
 * scratches roughly included). Pure: tests/schedule.test.ts.
 */

/** A friend's decks on the wire (`dk`): faders ×1000, offsets in ms, platter rates ×100, holds as bits. */
export function packDecks(v: { xf: number; volA: number; volB: number; offA: number; offB: number; rateA: number; rateB: number; holdA: number; holdB: number }): number[] {
  return [Math.round(v.xf * 1000), Math.round(v.volA * 1000), Math.round(v.volB * 1000), Math.round(v.offA * 1000), Math.round(v.offB * 1000), Math.round(v.rateA * 100), Math.round(v.rateB * 100), (v.holdA > 0.5 ? 1 : 0) | (v.holdB > 0.5 ? 2 : 0)];
}

export function unpackDecks(a: unknown) {
  if (!Array.isArray(a) || a.length < 8 || !a.every((x) => Number.isFinite(Number(x)))) return null;
  const n = a.map(Number);
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return { xf: c(n[0] / 1000), volA: c(n[1] / 1000), volB: c(n[2] / 1000), offA: n[3] / 1000, offB: n[4] / 1000, rateA: Math.max(-4, Math.min(4, n[5] / 100)), rateB: Math.max(-4, Math.min(4, n[6] / 100)), holdA: n[7] & 1 ? 1 : 0, holdB: n[7] & 2 ? 1 : 0 };
}
