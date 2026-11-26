import { describe, expect, it } from 'vitest';
import { recipeFor } from '../src/client/suiteperks';
import { BOTTLES } from '../src/client/loose';

const mix = (...parts: [keyof typeof BOTTLES, number][]) => new Map(parts.map(([n, a]) => [BOTTLES[n].liquid, a] as [number, number]));

describe('mixing drinks at the minibar', () => {
  it('names a house recipe', () => {
    expect(recipeFor(mix(['gin', 0.3], ['vodka', 0.2]))).toBe('Vesper Martini');
    expect(recipeFor(mix(['gin', 0.2], ['champagne', 0.4]))).toBe('French 75');
    expect(recipeFor(mix(['rum', 0.25], ['whisky', 0.25]))).toBe("Pirate's Grog");
  });

  it('prefers the bigger recipe (a Long Island holds a Vesper)', () => {
    expect(recipeFor(mix(['vodka', 0.1], ['gin', 0.1], ['rum', 0.1], ['tequila', 0.1]))).toBe('Long Island Iced Tea');
  });

  it("doesn't call a splash or a lone spirit a cocktail", () => {
    expect(recipeFor(mix(['gin', 0.05], ['vodka', 0.05]))).toBeNull();
    expect(recipeFor(mix(['whisky', 0.5]))).toBeNull();
    expect(recipeFor(mix(['gin', 0.45], ['vodka', 0.02]))).toBeNull();
  });
});
