import { describe, expect, it } from 'vitest';
import { GLIDE, MOVES, SHOW_CLIPS, micFree, songRoutine, stepAt } from '../src/client/party/routine';
import { SONG_BARS, SONG_SECTIONS } from '../src/client/party/setlist';

const endOf = (bars: { part: string }[]) => {
  for (let i = 20; i < bars.length; i++) if (bars[i].part === 'outro') return i;
  return bars.length - 2;
};

describe("the headliner's routine", () => {
  const routines = SONG_SECTIONS.map((s) => ({ end: endOf(s), r: songRoutine(endOf(s), SONG_BARS) }));

  it('covers each song beat by beat, back to back', () => {
    for (const { r } of routines) {
      expect(r[0].at).toBe(0);
      for (let i = 1; i < r.length; i++) expect(r[i].at).toBe(r[i - 1].at + r[i - 1].beats);
      const last = r[r.length - 1];
      expect(last.at + last.beats).toBe(SONG_BARS * 4);
    }
  });

  it('only uses moves that exist, and loops only the looping ones', () => {
    for (const { r } of routines)
      for (const s of r) {
        expect(SHOW_CLIPS).toContain(s.move);
        if (!MOVES[s.move].loop) expect(s.beats).toBeLessThanOrEqual(MOVES[s.move].beats);
        else expect(s.beats % 1).toBe(0);
      }
  });

  it('starts at the stand, takes the mic for the chorus and jumps on its downbeat', () => {
    for (const { r } of routines) {
      for (const s of r) if (s.at < 56) expect(s.hand).toBe(false);
      const jump = r.find((s) => s.cue === 'jump')!;
      expect(jump.at).toBe(64);
      expect(jump.hand).toBe(true);
      // Verse and pre-chorus on the spot (at the stand).
      for (const s of r) if (s.at < 64) expect([s.x0, s.x1]).toEqual([0, 0]);
    }
  });

  it('lands the final pose as the music lets go, and ends the song back at the mic', () => {
    for (const { end, r } of routines) {
      const fin = r.find((s) => s.cue === 'final')!;
      expect(fin.at).toBe(end * 4);
      expect(r[r.length - 1].x1).toBe(0);
    }
  });

  it('glides at the clips own speed (the planted foot stays put) and stays on the stage', () => {
    for (const { r } of routines)
      for (const s of r) {
        const dx = s.x1 - s.x0;
        if (s.move === 'Show_GlideL' || s.move === 'Show_GlideR') {
          const cycles = s.beats / MOVES[s.move].beats;
          expect(dx).toBeCloseTo(cycles * (MOVES[s.move].dx ?? 0), 6);
          expect(Math.sign(dx)).toBe(s.move === 'Show_GlideL' ? 1 : -1);
        } else expect(dx).toBe(0);
        // The riser runs 3.7 m either side of the mic: keep well inside it.
        expect(Math.abs(s.x0)).toBeLessThanOrEqual(4 * GLIDE + 1e-9);
      }
  });

  it('says where it is at any beat', () => {
    const r = routines[0].r;
    const a = stepAt(r, 0);
    expect(a.step.move).toBe('Show_Groove');
    expect(a.f).toBe(0);
    const g = r.find((s) => s.move === 'Show_GlideL')!;
    const mid = stepAt(r, g.at + g.beats / 2);
    expect(mid.x).toBeCloseTo((g.x0 + g.x1) / 2, 6);
    expect(mid.f).toBeGreaterThanOrEqual(0);
    expect(mid.f).toBeLessThan(1);
    // A one-shot past its end holds its last frame.
    const fin = r.find((s) => s.move === 'Show_Final')!;
    expect(stepAt(r, fin.at + 3.99).f).toBeLessThanOrEqual(1);
  });

  it('frees the mic hand only for moves that need the arm', () => {
    expect(micFree('Show_Glide' as never, 0.5)).toBe(0);
    expect(micFree('Show_Call', 0.7)).toBe(1);
    expect(micFree('Show_Call', 0.1)).toBe(0);
    expect(micFree('Show_Final', 0.9)).toBe(1);
  });
});
