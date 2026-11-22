/**
 * Quality tiers. Quest 3/3S is the reference VR device; Quest 2 runs the same
 * content with smaller textures and fewer lights. Desktop adds shadows and
 * extra lights; phones get the lightest settings.
 */
export type TierName = 'quest3' | 'quest2' | 'desktop' | 'mobile';

export interface Quality {
  name: TierName;
  label: string;
  /** Base size for large procedural textures (floor, carpet, felt). */
  texSize: number;
  pixelRatio: number;
  shadows: boolean;
  /** Extra point lights over the tables (beyond hemisphere + key light). */
  pointLights: number;
  /** Crystals per chandelier. */
  crystals: number;
  /** Glass flowers in the lobby ceiling. */
  flowers: number;
  /** Guests and staff on the floor. */
  people: number;
  /** Extra slot machines in the rows along the east side. */
  rowMachines: number;
  /** Lowest render scale the adaptive resolution may drop to. */
  minPixelRatio: number;
  xrFramebufferScale: number;
  antialias: boolean;
  anisotropy: number;
}

const TIERS: Record<TierName, Quality> = {
  quest3: {
    name: 'quest3',
    label: 'Quest 3',
    texSize: 2048,
    pixelRatio: 1,
    shadows: false,
    pointLights: 2,
    crystals: 48,
    flowers: 900,
    people: 38,
    rowMachines: 24,
    minPixelRatio: 1,
    xrFramebufferScale: 1.2,
    antialias: true,
    anisotropy: 4,
  },
  quest2: {
    name: 'quest2',
    label: 'Quest 2',
    texSize: 1024,
    pixelRatio: 1,
    shadows: false,
    pointLights: 0,
    crystals: 24,
    flowers: 450,
    people: 28,
    rowMachines: 17,
    minPixelRatio: 1,
    xrFramebufferScale: 1.0,
    antialias: true,
    anisotropy: 2,
  },
  desktop: {
    name: 'desktop',
    label: 'Desktop',
    texSize: 2048,
    pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 2),
    shadows: true,
    pointLights: 6,
    crystals: 72,
    flowers: 1400,
    people: 48,
    rowMachines: 24,
    minPixelRatio: 0.6,
    xrFramebufferScale: 1.0,
    antialias: true,
    anisotropy: 8,
  },
  mobile: {
    name: 'mobile',
    label: 'Mobile',
    texSize: 1024,
    pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 1.25),
    shadows: false,
    pointLights: 0,
    crystals: 16,
    flowers: 320,
    people: 22,
    rowMachines: 10,
    minPixelRatio: 0.55,
    xrFramebufferScale: 1.0,
    antialias: false,
    anisotropy: 2,
  },
};

export function detectTier(): Quality {
  const override = new URLSearchParams(location.search).get('quality') as TierName | null;
  if (override && TIERS[override]) return TIERS[override];
  const ua = navigator.userAgent;
  if (/OculusBrowser|Quest/i.test(ua)) {
    // Quest 2 reports "Quest 2"; Quest 3/3S and newer get the higher tier.
    return /Quest 2/i.test(ua) ? TIERS.quest2 : TIERS.quest3;
  }
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return TIERS.mobile;
  return TIERS.desktop;
}

export const isQuest = (q: Quality) => q.name === 'quest2' || q.name === 'quest3';
