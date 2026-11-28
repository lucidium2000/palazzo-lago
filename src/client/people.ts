import * as THREE from 'three';
import type { Quality } from './quality';
import type { World } from './world';
import { spawnCharacter, type PeopleLib } from './assets';
import type { Paint, Surface } from './peopleshade';
import { FINGER, orientHand, reach, setFingers } from './net/embody';
import { lieLegs, sitLegs, standLegs } from './sitpose';
import { DAB_HEAD, dabAngles, dabWeight } from './dab';
import { fightAim, fightHandoff, fightMix, type FightPose } from './fightanim';
import { showMix, type ShowPose } from './party/showanim';
import { dry, linkRoutes, pathTo } from './routes';
import { promenadeShare } from './areas/promenadeplan';
import { entranceShare } from './areas/entranceplan';
import { bowlingShare } from './bowling/plan';

/** Beyond this, people aren't drawn on any tier (the far parts of the resort: the Promenade, the suite). */
const FAR_CULL = 120;

// Bone offsets for poses the clips don't have (tuned against the Quaternius rig).
export const POSE = { sitThigh: 1.5, sitShin: -1.6, sitHips: 0.95, trayUpper: 0.9, trayLower: 1.2, trayAxis: 'x' as 'x' | 'z' };
/** Where a server holds the tray: the hand ahead of the shoulder, out and down, in arm lengths. */
export const CARRY = { fwd: 0.6, out: 0.1, down: 0.24 };
/** The waiter's tray: radius, and thickness under its top surface. */
export const TRAY_R = 0.17;
export const TRAY_UNDER = 0.012;

/** Remembers the right arm's bind pose (the tray carry starts from it every frame). */
function keepArmRest(rig: { bones: Record<string, THREE.Object3D> }) {
  for (const n of ['UpperArmR', 'LowerArmR', 'WristR']) {
    const bn = rig.bones[n];
    if (bn) bn.userData.carryRest ??= bn.quaternion.clone();
  }
}

/**
 * The casino's guests and staff. Every body part is one InstancedMesh shared by
 * the whole crowd, so two dozen animated people cost about a dozen draw calls.
 * People are posed procedurally (no skinned assets yet): walk cycles, sitting,
 * reaching for slot buttons, cheering, dealing, pouring, playing piano.
 */

export type Role = 'wander' | 'slots' | 'watch' | 'croupier' | 'bartender' | 'patron' | 'pianist' | 'waiter' | 'buddy' | 'chat' | 'pair' | 'guard';

/** A conversation circle: members face the middle and take turns talking. */
export interface Talk {
  members: Person[];
  speaker: number;
  nextTurn: number;
  laughUntil: number;
  /** A scripted line is being said: hold the turn until then. */
  scriptUntil?: number;
}

export interface Look {
  dress: boolean;
  /** Top garment colour (jacket, dress, shirt…), sRGB hex. */
  main: number;
  /** Shirt / blouse under it. */
  second: number;
  skin: number;
  hair: number;
  hairStyle: 'short' | 'long' | 'bald' | 'bun';
  height: number;
  /** Which character model to wear (see assets.ts). */
  kind?: string;
  // --- Outfit details (peopleshade.ts); sensible defaults per kind when left out.
  /** Trousers / skirt / shorts (defaults to `main`: a suit or a dress). */
  bottom?: number;
  shoes?: number;
  /** Tie, the shorts' print, the sneakers' trim. */
  accent?: number;
  topSurf?: Surface;
  bottomSurf?: Surface;
  shirtSurf?: Surface;
  shoeSurf?: Surface;
  accentSurf?: Surface;
  /** Jewellery / watch metal, and whether it catches the light. */
  jewel?: number;
  glint?: boolean;
  lipstick?: number;
}

export { fightPose, type FightPose } from './fightanim';

export class Person {
  pos = new THREE.Vector3();
  yaw = 0;
  /** Where the body should face when stationary. */
  homeYaw = 0;
  speed = 1;
  walkPhase = Math.random() * 10;
  moving = 0;
  /** Seconds left in a cheer / reaction. */
  cheer = 0;
  /** Seconds left in a dab (a friend's avatar dabbing with you: dab.ts). */
  dabT = 0;
  gaspT = 0;
  action = 0;
  actionKind: 'none' | 'tap' | 'sip' | 'reach' | 'pour' | 'wipe' | 'offer' = 'none';
  pause = 0;
  headYaw = 0;
  headPitch = 0;
  target: number | null = null;
  prev: number | null = null;
  /** Heading somewhere in particular (the pool, the bar…): the nodes still to walk through. */
  route: number[] = [];
  /** Where this guest likes to be (the pool deck…): most of their trips end there. */
  haunt: ((x: number, z: number) => boolean) | null = null;
  seated = false;
  /** Not here right now (a concert-goer who hasn't arrived yet, or has gone home): not drawn, not animated. */
  away = false;
  /**
   * Someone else keeps their place and walks them back to it after you push
   * past (her audience: party/audience.ts), so bodies.ts doesn't.
   */
  placed = false;
  /** Knocked off their seat (see seatshove.ts): standing, walking about, coming back to it. */
  offSeat = false;
  /** Never knocked off their seat (a game seats them itself: the poker table). */
  keepSeat = false;
  /** Hip height when seated (bar stools are taller than slot stools). */
  seatY = 0.62;
  /**
   * Lying back (a sun lounger): how far the body reclines from upright, radians
   * (0 = sitting up). Only while seated; the hips go on the seat at seatY, a
   * little behind pos (toward the backrest).
   */
  lie = 0;
  /** Swimming: the height of their head (the body lies flat behind it); null when not swimming. */
  swimHead: number | null = null;
  swimBlend = 0;
  /** Per-person randomness for idle motion. */
  seed = Math.random() * 100;
  /**
   * Who this is across the room's machines: guests and staff are numbered in the order the game
   * creates them (the same on every machine running the same build and quality); -1 for buddies
   * (your crew, friends' avatars), who are different on each machine.
   */
  uid = -1;
  /** Invisible proxy used for clicks (waiters). */
  proxy?: THREE.Mesh;
  onUpdate?: (p: Person, dt: number) => void;
  /** Driven by a real player over the network: no automatic head turning. */
  driven = false;
  /** Has a mouth of its own (a friend's avatar, mouth driven by their voice): faces.ts leaves it alone. */
  ownMouth = false;
  /** Runs after the animation pose each frame (arms reaching for real hands, the mouth talking). */
  onPose?: (p: Person) => void;
  /** The animated character (when the people assets loaded). */
  rig?: ReturnType<typeof spawnCharacter>;
  /** Animation clock skipping for far-away people. */
  animSkip = 0;
  animDt = 0;
  tray?: THREE.Object3D;
  // --- Social life ------------------------------------------------------------
  /** A conversation circle this person stands in. */
  talk: Talk | null = null;
  /** Walks beside this person (a couple / friends out together). */
  follow: Person | null = null;
  /** Briefly stopped to chat with someone met on the way. */
  chatWith: Person | null = null;
  chatT = 0;
  chatCd = 0;
  /** Something in hand. */
  prop: 'none' | 'glass' | 'phone' = 'none';
  /** Taking photos: looks up with the phone raised. */
  photo = false;
  /** 0..1: how animated their gestures are right now (talking). */
  talking = 0;
  laughT = 0;
  sipT = 0;
  nextSip = 4 + Math.random() * 10;
  /** Some people are curious and glance at newcomers; most mind their own business. */
  curious = Math.random() < 0.18;
  glanceUntil = 0;
  glanceCd = 3 + Math.random() * 15;
  /** Hidden this frame (too far away on a headset). */
  culled = false;
  /** Staff with a voice of their own (an id in SPEAKERS, cast.ts: the Promenade's cooks and clerk). */
  speaker: string | null = null;
  /** One of the pool party's performers (party/performers.ts): they don't chat like guests. */
  performer: 'singer' | 'band' | 'dj' | null = null;
  /** Performing right now (on stage, at the decks): not a word, only physical reactions (party/partytalk.ts). */
  hush = false;
  /** Talking with you: looks at you until then. */
  attendUntil = 0;
  /** Saying a line (outside a circle): talking gestures until then. */
  speakUntil = 0;
  /** In a fight (fight/): the fight module moves them and poses their arms; their usual walking stops. */
  fight: FightPose | null = null;
  /** On stage (the headliner: party/stage.ts): his stage moves, played by the beat (party/showanim.ts). */
  show: ShowPose | null = null;
  /** How angry they look, 0..1 (brows down). */
  angry = 0;
  /** A slapped cheek going red (seconds left), and which side (0 = their left, 1 = their right). */
  blush = 0;
  blushSide: 0 | 1 = 0;
  /** Head knocked back (pitch) and sideways (yaw) by a hit or a slap, radians (springs back). */
  snapX = 0;
  snapY = 0;

  constructor(
    readonly role: Role,
    readonly look: Look,
  ) {}
}

// Palettes (sRGB). A Vegas night: black tie and dark suits, jewel-toned and
// metallic cocktail dresses, smart-casual and resort wear; no clashing brights.
const SKIN = [0xf4d8c4, 0xecc4a6, 0xe2b08c, 0xd29b74, 0xc08660, 0xa8714c, 0x8e5a3a, 0x7a4a30, 0x6a3f28, 0x5a3523];
const HAIR_YOUNG = [0x120d0b, 0x1e1510, 0x2e1f15, 0x45301f, 0x5e3f26, 0x6e3a20, 0x8a6a46, 0xb8955e, 0xd8c49a, 0x3a2416];
const HAIR_GREY = [0x8a847c, 0xb4aea6, 0xd2cdc4, 0x5e5650];
const SUITS = [0x0c0c0e, 0x101524, 0x161c30, 0x232428, 0x34363b, 0x1c2235, 0x2b211a, 0x3a3d44];
const SHIRTS = [0xf4f2ec, 0xf4f2ec, 0xece4d4, 0xd2dde9, 0xe9d7d4, 0x121214];
const TIES = [0x0e0e10, 0x4e1220, 0x1a2342, 0x7c7e84, 0x2e3a2a, 0x5a4220];
const DRESSES: [number, Surface][] = [
  [0x0d0d10, 'satin'], [0x0d0d10, 'sequin'], [0x7c0e1c, 'satin'], [0x0c4030, 'satin'], [0x14306a, 'satin'], [0xcdb07c, 'sequin'],
  [0xa88440, 'sequin'], [0xb4b4ba, 'sequin'], [0x4c0e1e, 'velvet'], [0x401640, 'satin'], [0xc8968c, 'satin'], [0x151a34, 'velvet'],
  [0xe8e2d6, 'satin'], [0x1a1a1e, 'velvet'], [0x6a1426, 'sequin'],
];
const DRESS_SHOES = [0x0c0b0b, 0x0c0b0b, 0xb88e70, 0x6a0e18, 0xa8844a];
const PANTSUITS = [0x0e0e10, 0x141a2c, 0xe4dccc, 0x9c7a54, 0x4a1020, 0x1c3a30, 0xf0ece4, 0x2c2c30];
const BLOUSES = [0xf4f0e8, 0x0e0e10, 0xd8c09a, 0xe6cfc6, 0xc8ccd4];
const CASUAL_TOPS = [0xf2efe8, 0xe8dcc8, 0xc86e5e, 0xa6c0d8, 0x101012, 0x96a486, 0xd8b0a8, 0x2a3a5a, 0xb8504a];
const CASUAL_BOTTOMS = [0xefebe2, 0x121214, 0x3a4a68, 0xae9870, 0x1e2a44, 0x50553a, 0x2a3550];
// male_casual_2 wears a fitted tee: cotton mostly, now and then a black silk shirt.
const TEES: [number, Surface][] = [[0xf0eee8, 'cotton'], [0x121214, 'cotton'], [0x1e2842, 'cotton'], [0x8a8c90, 'cotton'], [0x4a4a32, 'cotton'], [0x4a1620, 'cotton'], [0xb8a688, 'cotton'], [0x0e0e10, 'silk'], [0x2c4a5a, 'cotton']];
const JEANS: [number, Surface][] = [[0x27324e, 'denim'], [0x1b2030, 'denim'], [0x151517, 'denim'], [0x5a5d64, 'denim'], [0xa69470, 'cotton'], [0x2a2a2e, 'wool']];
const SNEAKERS = [0xeceae4, 0xeceae4, 0x141414, 0x4a2e1c, 0x2a3450];
const RESORT_SHIRTS = [0xf2efe6, 0xb8cce0, 0xe0b8b2, 0xa8cab6, 0x1e2a44, 0xd0806a, 0x2f747c, 0xd8bf72, 0xe8e0cc];
const SHORTS = [0x1e2a44, 0xece8de, 0xae9a72, 0x6a1c26, 0x2a7e8c, 0x161618, 0x6a7a5a];
const LIPSTICKS = [0x8a1e28, 0x9a4a4a, 0x6a1a26, 0xa85a58];
const GOLD = 0xd8b46a;
const SILVER = 0xd4d4da;

let seedN = 7;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

function hairFor(): number {
  return rnd() < 0.16 ? pick(HAIR_GREY) : pick(HAIR_YOUNG);
}

/** An outfit for a character model: its colours and fabrics. */
function outfit(kind: string, pool = false): Partial<Look> & { main: number; second: number } {
  const metal = rnd() < 0.6 ? GOLD : SILVER;
  switch (kind) {
    case 'male_suit': {
      const tux = rnd() < 0.3;
      const main = tux ? 0x0a0a0c : pick(SUITS);
      return { main, second: tux ? 0xf6f4ee : pick(SHIRTS), accent: tux ? 0x08080a : pick(TIES), accentSurf: tux ? 'satin' : 'silk', topSurf: 'wool', bottomSurf: 'wool', shirtSurf: 'cotton', shoes: rnd() < 0.8 ? 0x0c0a09 : 0x3a2214, shoeSurf: tux ? 'patent' : 'leather', jewel: metal, glint: rnd() < 0.35 };
    }
    case 'female_formal': {
      const [main, surf] = pool ? [pick([0xe8e2d6, 0xc8968c, 0x2f747c, 0x14306a, 0xd8bf72]), 'silk' as Surface] : pick(DRESSES);
      return { main, second: main, topSurf: surf, bottomSurf: surf, shoes: pick(DRESS_SHOES), shoeSurf: 'patent', jewel: metal, glint: rnd() < 0.7, lipstick: rnd() < 0.55 ? pick(LIPSTICKS) : undefined };
    }
    case 'female_suit': {
      const main = pick(PANTSUITS);
      return { main, second: pick(BLOUSES), topSurf: 'wool', bottomSurf: 'wool', shirtSurf: 'silk', shoes: rnd() < 0.7 ? 0x0c0b0b : 0xb88e70, shoeSurf: 'patent', jewel: metal, glint: rnd() < 0.5, lipstick: rnd() < 0.4 ? pick(LIPSTICKS) : undefined };
    }
    case 'female_casual': {
      const top = pick(pool ? RESORT_SHIRTS : CASUAL_TOPS);
      let bottom = pick(CASUAL_BOTTOMS);
      if (bottom === top) bottom = 0x121214;
      return { main: top, second: top, bottom, topSurf: rnd() < 0.4 ? 'silk' : 'cotton', bottomSurf: bottom === 0x3a4a68 || bottom === 0x2a3550 ? 'denim' : 'cotton', shoes: pick([0xeceae4, 0xb88e70, 0x121212, 0xc8a878]), shoeSurf: 'leather', jewel: metal, glint: false };
    }
    case 'male_casual_2': {
      const [main, topSurf] = pick(TEES);
      const [bottom, bottomSurf] = pick(JEANS);
      const shoes = pick(SNEAKERS);
      return { main, second: main, bottom, topSurf, bottomSurf, shoes, shoeSurf: shoes === 0x4a2e1c ? 'leather' : 'cotton', jewel: metal, glint: false };
    }
    case 'male_beach': {
      const main = pick(RESORT_SHIRTS);
      const bottom = pick(SHORTS);
      return { main, second: main, bottom, accent: rnd() < 0.5 ? 0xf2efe6 : bottom, accentSurf: 'cotton', topSurf: rnd() < 0.5 ? 'silk' : 'cotton', bottomSurf: 'cotton', shoes: pick([0x161414, 0x4a3020, 0x1e2a44]), shoeSurf: 'rubber', jewel: metal, glint: false };
    }
  }
  return { main: pick(SUITS), second: pick(SHIRTS) };
}

export function randomLook(): Look {
  const dress = rnd() < 0.45;
  // A night at a Strip resort: mostly dressed up, some vacation casual.
  const r = rnd();
  const kind = dress ? (r < 0.45 ? 'female_formal' : r < 0.7 ? 'female_suit' : 'female_casual') : r < 0.5 ? 'male_suit' : r < 0.8 ? 'male_casual_2' : 'male_beach';
  return {
    kind,
    dress,
    ...outfit(kind),
    skin: pick(SKIN),
    hair: hairFor(),
    hairStyle: dress ? (rnd() < 0.6 ? 'long' : 'bun') : rnd() < 0.15 ? 'bald' : 'short',
    height: (dress ? 1.66 : 1.78) + (rnd() - 0.5) * 0.14,
  };
}

/** Beachwear for the pool party: board shorts, or a casual summer outfit. */
export function poolLook(): Look {
  const base = randomLook();
  const dress = rnd() < 0.45;
  const kind = dress ? (rnd() < 0.25 ? 'female_formal' : 'female_casual') : 'male_beach';
  return {
    ...base,
    ...outfit(kind, true),
    dress,
    kind,
    hairStyle: dress ? (rnd() < 0.5 ? 'long' : 'bun') : rnd() < 0.15 ? 'bald' : 'short',
    height: (dress ? 1.66 : 1.78) + (rnd() - 0.5) * 0.14,
  };
}

export function staffLook(kind: 'dealer' | 'dealerF' | 'bar' | 'waiter' | 'pianist'): Look {
  const base = randomLook();
  const uniform = { jewel: SILVER, glint: false, shoes: 0x0a0909, shoeSurf: 'leather' as Surface, shirtSurf: 'cotton' as Surface, topSurf: 'wool' as Surface, bottomSurf: 'wool' as Surface };
  const hair = base.hair;
  // Dealers: black waistcoat look, white shirt, the house's burgundy tie.
  if (kind === 'dealer') return { ...base, ...uniform, hair, dress: false, main: 0x14100e, second: 0xf6f2ea, bottom: 0x0e0c0b, accent: 0x5a0e18, accentSurf: 'silk', hairStyle: base.hairStyle === 'long' ? 'bun' : base.hairStyle, kind: 'male_suit', height: 1.8 };
  // Women dealers (blackjack, poker): the same black waistcoat and burgundy tie, hair up.
  if (kind === 'dealerF') return { ...base, ...uniform, dress: true, main: 0x14100e, second: 0xf6f2ea, bottom: 0x0e0c0b, accent: 0x5a0e18, accentSurf: 'silk', hairStyle: 'bun', kind: 'female_suit', height: 1.7 };
  // Bartenders: the house burgundy jacket over a white shirt, black trousers.
  if (kind === 'bar') return { ...base, ...uniform, dress: false, main: 0x5a0e18, second: 0xf6f2ea, bottom: 0x0e0c0b, kind: 'female_suit', height: 1.7 };
  if (kind === 'pianist') return { ...base, ...uniform, dress: false, main: 0x0a0a0c, second: 0xf6f4ee, bottom: 0x0a0a0c, accent: 0x08080a, accentSurf: 'satin', shoeSurf: 'patent', kind: 'male_suit', height: 1.8 };
  // Cocktail waitresses: an ivory satin dress.
  return { ...base, ...uniform, dress: false, main: 0xf0ead8, second: 0xf0ead8, bottom: 0xf0ead8, topSurf: 'satin', bottomSurf: 'satin', shoeSurf: 'patent', jewel: GOLD, hairStyle: base.hairStyle === 'long' ? 'bun' : base.hairStyle, kind: 'female_formal', height: 1.7 };
}

/** What a look paints on its character (peopleshade.ts), with defaults for anything left out. */
export function lookPaint(look: Look): Paint {
  const kind = look.kind ?? (look.dress ? 'female_formal' : 'male_suit');
  const casual = kind === 'female_casual' || kind === 'male_casual_2' || kind === 'male_beach';
  return {
    skin: look.skin,
    hair: look.hair,
    top: look.main,
    topSurf: look.topSurf ?? (casual ? 'cotton' : kind === 'female_formal' ? 'satin' : 'wool'),
    bottom: look.bottom ?? (casual ? (kind === 'male_beach' ? 0x1e2a44 : 0x27324e) : look.main),
    bottomSurf: look.bottomSurf ?? look.topSurf ?? (casual ? 'denim' : kind === 'female_formal' ? 'satin' : 'wool'),
    shirt: look.second,
    shirtSurf: look.shirtSurf ?? 'cotton',
    shoes: look.shoes ?? 0x0c0a09,
    shoeSurf: look.shoeSurf ?? (kind === 'male_beach' ? 'rubber' : 'leather'),
    accent: look.accent ?? (kind === 'male_beach' ? 0xf2efe6 : 0x1a1a1e),
    accentSurf: look.accentSurf ?? 'silk',
    jewel: look.jewel ?? GOLD,
    glint: look.glint ?? false,
    lipstick: look.lipstick,
  };
}

// Body proportions for a 1.75 m person (scaled per height).
const HIP_Y = 0.92;
const THIGH = 0.45;
const SHIN = 0.44;
const TORSO = 0.58;
const UPPER = 0.3;
const FORE = 0.27;

interface Part {
  mesh: THREE.InstancedMesh;
  perPerson: number;
}

function faceTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  // Front of a SphereGeometry is at u = 0.25.
  const cx = 64;
  g.fillStyle = '#2a1a12';
  g.beginPath();
  g.ellipse(cx - 10, 58, 3.2, 2.4, 0, 0, Math.PI * 2);
  g.ellipse(cx + 10, 58, 3.2, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(60,35,20,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - 15, 51);
  g.quadraticCurveTo(cx - 10, 48, cx - 5, 51);
  g.moveTo(cx + 5, 51);
  g.quadraticCurveTo(cx + 10, 48, cx + 15, 51);
  g.stroke();
  g.fillStyle = 'rgba(150,70,60,0.75)';
  g.beginPath();
  g.ellipse(cx, 76, 6, 2.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(120,70,50,0.25)';
  g.beginPath();
  g.ellipse(cx, 66, 2.5, 4, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const down = (g: THREE.BufferGeometry, len: number) => g.translate(0, -len / 2, 0);

export class Crowd {
  readonly people: Person[] = [];
  /** The quality tier's crowd size (the floor's share). */
  readonly tierPeople: number;
  /** Slots still held back for the pool stage (her band, her concert-goers). */
  private reserve = 0;
  private nextUid = 0;
  private parts: Record<string, Part> = {};
  private max: number;
  private m = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private nodes: THREE.Vector2[] = [];
  private edges: number[][] = [];
  private shadowMesh: THREE.InstancedMesh;
  private trays: THREE.InstancedMesh;
  readonly group = new THREE.Group();
  /** Drinks and phones in hand (one draw each for everybody). */
  /** Drinks in guests' hands (one instance each); `glassOwners[i]` holds instance i's glass. */
  readonly glasses: THREE.InstancedMesh;
  readonly glassOwners: Person[] = [];
  private phones: THREE.InstancedMesh;
  private talks: Talk[] = [];
  /** On headsets and phones, people this far away aren't drawn. */
  private cullDist: number;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    q: Quality,
    private world: World,
    private lib: PeopleLib | null = null,
  ) {
    // Three extra slots are always kept for your crew. The pool party gets its own
    // share on top of the floor's: it's culled from the casino (and the casino from
    // the deck) on headsets and phones, so it costs little to draw.
    // (And the Promenade's diners, cooks and shoppers: far from the floor, never drawn from it.)
    // (And the front entrance's doorman, valets and guests coming and going.)
    // (And Palazzo Lanes: the bowlers, the bar and the shoe counter.)
    this.tierPeople = q.people;
    this.reserve = Crowd.stageShare(q.people);
    this.max = q.people + Crowd.poolShare(q.people) + Crowd.stageShare(q.people) + promenadeShare(q.people) + entranceShare(q.people) + bowlingShare(q.people) + 6; // 3 crew + 2 security guards + 1 remote player reserved
    scene.add(this.group);
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.75, envMapIntensity: 0.6 });
    const satin = new THREE.MeshStandardMaterial({ roughness: 0.35, envMapIntensity: 1.0 });
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.6, map: faceTexture() });
    const skinPlain = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.25, envMapIntensity: 1.2 });
    const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, perPerson: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, this.max * perPerson);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.raycast = () => {};
      if (mat !== shoeMat) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * perPerson * 3), 3);
      this.group.add(mesh);
      this.parts[name] = { mesh, perPerson };
    };
    add('thigh', down(new THREE.CapsuleGeometry(0.075, THIGH - 0.1, 4, 8), THIGH), cloth, 2);
    add('shin', down(new THREE.CapsuleGeometry(0.06, SHIN - 0.08, 4, 8), SHIN), cloth, 2);
    add('shoe', new THREE.BoxGeometry(0.09, 0.07, 0.24).translate(0, -0.02, 0.05), shoeMat, 2);
    add('torso', new THREE.CylinderGeometry(0.19, 0.155, TORSO, 12, 1).translate(0, TORSO / 2, 0), cloth, 1);
    add('skirt', new THREE.CylinderGeometry(0.16, 0.33, 0.78, 14, 1, true).translate(0, -0.39, 0), satin, 1);
    add('shirt', new THREE.BoxGeometry(0.12, 0.2, 0.02).translate(0, TORSO - 0.12, 0.165), cloth, 1);
    add('upper', down(new THREE.CapsuleGeometry(0.05, UPPER - 0.08, 4, 8), UPPER), cloth, 2);
    add('fore', down(new THREE.CapsuleGeometry(0.042, FORE - 0.06, 4, 8), FORE), cloth, 2);
    add('hand', new THREE.SphereGeometry(0.045, 8, 6).scale(0.8, 1.1, 0.6), skinPlain, 2);
    const head = new THREE.SphereGeometry(0.105, 18, 12).scale(0.92, 1.08, 1.0).translate(0, 0.16, 0);
    add('head', head, skin, 1);
    add('neck', new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 0.05, 0), skinPlain, 1);
    add('hair', new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.05).translate(0, 0.17, -0.012), hairMat, 1);

    // Soft contact shadows under everyone.
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const sg = sc.getContext('2d')!;
    const grad = sg.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
    this.shadowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
      this.max,
    );
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.count = 0;
    this.shadowMesh.raycast = () => {};
    this.group.add(this.shadowMesh);

    // Waiters' trays with two flutes each.
    const tray = new THREE.CylinderGeometry(0.17, 0.17, 0.012, 20);
    const flute = new THREE.CylinderGeometry(0.022, 0.012, 0.16, 8).translate(0, 0.085, 0);
    const trayGeo = mergeAll([tray, flute.clone().translate(0.06, 0, 0.02), flute.clone().translate(-0.05, 0, -0.03)]);
    this.trays = new THREE.InstancedMesh(trayGeo, new THREE.MeshStandardMaterial({ color: 0xd9c08a, metalness: 0.9, roughness: 0.25 }), 6);
    this.trays.frustumCulled = false;
    this.trays.count = 0;
    this.trays.raycast = () => {};
    this.group.add(this.trays);

    // Cocktails and phones held by guests.
    const tumbler = new THREE.CylinderGeometry(0.032, 0.026, 0.1, 10).translate(0, 0.05, 0);
    const drink = new THREE.CylinderGeometry(0.028, 0.024, 0.06, 10).translate(0, 0.032, 0);
    this.glasses = new THREE.InstancedMesh(
      mergeAll([tumbler, drink.scale(0.98, 1, 0.98)]),
      new THREE.MeshStandardMaterial({ color: 0xe8d2a8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.6 }),
      this.max,
    );
    this.phones = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.075, 0.15, 0.009),
      new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.6, emissive: 0x6a8aff, emissiveIntensity: 0.15 }),
      this.max,
    );
    for (const m of [this.glasses, this.phones]) {
      m.frustumCulled = false;
      m.count = 0;
      m.raycast = () => {};
      this.group.add(m);
    }
    // Guests' drinks can be clicked (and taken: see stock.ts); the owners are kept by instance.
    this.glasses.name = 'held-glasses';
    this.glasses.raycast = THREE.InstancedMesh.prototype.raycast;
    // Far enough to see people across the hall and down the hotel corridor.
    this.cullDist = q.name === 'quest2' ? 18 : q.name === 'mobile' ? 16 : q.name === 'quest3' ? 20 : Infinity;
  }

  /** Extra guests for the pool deck, on top of the floor's `people`. */
  /**
   * The pool stage's people on top of the pool's share: her band (3), and the
   * concert-goers who arrive while she's on (the audience doubles: as many as
   * the dancers they join; fewer on headsets and phones). They're away (not
   * drawn, not animated) until she comes on.
   */
  static stageShare(people: number) {
    return 3 + Crowd.concertExtras(people);
  }

  static concertExtras(people: number) {
    // (More than doubling her audience: the deck behind them fills with backcrowd.ts's instanced fans too.)
    return people >= 60 ? 20 : people >= 50 ? 16 : people >= 40 ? 13 : 10;
  }

  static poolShare(people: number) {
    // Headsets and phones (smaller crowds) get a lighter pool party: CPU, not draw calls, is their limit.
    return people >= 60 ? Math.min(32, Math.round(people * 0.5)) : Math.min(18, Math.round(people * 0.3));
  }

  /**
   * A conversation circle of `n` guests at a free spot near (x, z). Some hold
   * drinks. Returns the members added (fewer if the floor there is crowded).
   */
  addGroup(x: number, z: number, n: number, opts: { drinks?: number } = {}): Person[] {
    const members: Person[] = [];
    const r = n <= 2 ? 0.48 : 0.62;
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      const px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (!this.world.isFree(px, pz, 0.22, true)) continue;
      const yaw = Math.atan2(x - px, z - pz);
      const p = this.add('chat', randomLook(), new THREE.Vector3(px, 0, pz), yaw);
      if (!p) break;
      if (rnd() < (opts.drinks ?? 0.5)) p.prop = 'glass';
      members.push(p);
    }
    if (members.length >= 2) {
      const t: Talk = { members, speaker: 0, nextTurn: 2 + rnd() * 3, laughUntil: 0 };
      for (const m of members) m.talk = t;
      this.talks.push(t);
    }
    return members;
  }

  /** Makes these people a conversation circle (they take turns talking). */
  converse(members: Person[]): Talk | null {
    if (members.length < 2) return null;
    const t: Talk = { members, speaker: 0, nextTurn: this.time + 2 + rnd() * 3, laughUntil: 0 };
    for (const m of members) m.talk = t;
    this.talks.push(t);
    return t;
  }

  /** Conversation circles on the floor (the dialogue system scripts what they say). */
  get conversations(): readonly Talk[] {
    return this.talks;
  }

  get now() {
    return this.time;
  }

  /** Makes `p` the one talking for `seconds` (gestures; in a circle, holds the turn). */
  speak(p: Person, seconds: number) {
    const t = p.talk;
    if (t) {
      const k = t.members.indexOf(p);
      if (k >= 0) {
        t.speaker = k;
        t.scriptUntil = this.time + seconds;
        t.nextTurn = this.time + seconds + 0.6;
      }
    }
    p.speakUntil = this.time + seconds;
  }

  /** Two friends (or a couple) strolling the floor together. */
  addPair(at: THREE.Vector3): Person[] {
    const lead = this.add('wander', randomLook(), at);
    if (!lead) return [];
    lead.speed = 0.75 + rnd() * 0.2;
    const friend = this.add('pair', randomLook(), at.clone().add(new THREE.Vector3(0.6, 0, 0)));
    if (!friend) return [lead];
    friend.follow = lead;
    if (rnd() < 0.4) friend.prop = 'glass';
    return [lead, friend];
  }

  /** A guest snapping photos (of the glass ceiling, the fountains…), looking at `subject`. */
  addPhotographer(at: THREE.Vector3, subject: THREE.Vector3): Person | null {
    const yaw = Math.atan2(subject.x - at.x, subject.z - at.z);
    const p = this.add('chat', randomLook(), at, yaw);
    if (!p) return null;
    p.prop = 'phone';
    p.photo = true;
    return p;
  }

  get capacity() {
    return this.max - 6;
  }

  add(role: Role, look: Look, at: THREE.Vector3, yaw = 0, opts: { reserved?: boolean } = {}): Person | null {
    // (The pool stage's share is held back from everyone else: her band and her concert-goers draw on it.)
    const limit = role === 'buddy' || role === 'guard' ? this.max : opts.reserved ? this.max - 6 : this.max - 6 - this.reserve;
    if (this.people.length >= limit) return null;
    if (opts.reserved) this.reserve = Math.max(0, this.reserve - 1);
    const p = new Person(role, look);
    p.pos.copy(at);
    p.yaw = p.homeYaw = yaw;
    p.speed = 0.85 + rnd() * 0.4;
    p.seated = role === 'slots' || role === 'patron' || role === 'pianist';
    if (role !== 'buddy') {
      p.uid = this.nextUid++;
      // Their personality (character, voice, idle rhythm) comes from who they are, so a guest is the
      // same person with the same voice on every player's machine.
      const h = Math.sin(p.uid * 12.9898 + 78.233) * 43758.5453;
      p.seed = (h - Math.floor(h)) * 100;
    }
    this.people.push(p);
    const i = this.people.length - 1;
    const set = (name: string, color: number) => {
      const part = this.parts[name];
      for (let k = 0; k < part.perPerson; k++) part.mesh.setColorAt(i * part.perPerson + k, new THREE.Color(color));
      part.mesh.count = this.people.length * part.perPerson;
    };
    const legColor = look.dress ? look.skin : look.main;
    set('thigh', legColor);
    set('shin', look.dress ? look.skin : look.main);
    this.parts.shoe.mesh.count = this.people.length * 2;
    set('torso', look.main);
    set('skirt', look.main);
    set('shirt', look.second);
    set('upper', look.dress && role !== 'waiter' ? look.skin : look.main);
    set('fore', look.dress && role !== 'waiter' ? look.skin : look.main);
    set('hand', look.skin);
    set('head', look.skin);
    set('neck', look.skin);
    set('hair', look.hair);
    this.shadowMesh.count = this.people.length;
    for (const part of Object.values(this.parts)) if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    if (this.lib) {
      const rig = spawnCharacter(this.lib, look.kind ?? (look.dress ? 'female_formal' : 'male_suit'), lookPaint(look));
      p.rig = rig;
      this.group.add(rig.root);
      for (const [name, a] of Object.entries(rig.actions)) {
        a.play();
        a.setEffectiveWeight(name === 'Idle_Neutral' ? 1 : 0);
        a.time = Math.random() * a.getClip().duration;
      }
      if (role === 'waiter') {
        // A real tray (the drinks on it are real glasses you can take: see waitertray.ts).
        // It rides on her right hand: see carryTray.
        p.tray = this.makeTray();
        keepArmRest(rig);
      }
      for (const part of Object.values(this.parts)) part.mesh.visible = false;
    }
    return p;
  }

  /** Swaps a person's character model (a friend changing their avatar). */
  setLook(p: Person, look: Look) {
    if (!this.lib || !p.rig) return;
    this.group.remove(p.rig.root);
    const rig = spawnCharacter(this.lib, look.kind ?? 'male_suit', lookPaint(look));
    for (const [name, a] of Object.entries(rig.actions)) {
      a.play();
      a.setEffectiveWeight(name === 'Idle_Neutral' ? 1 : 0);
    }
    p.rig = rig;
    (p as { look: Look }).look = look;
    if (p.tray) {
      // Re-seated on the new body's hand on the next pose.
      p.tray.removeFromParent();
      delete p.tray.userData.onHand;
      keepArmRest(rig);
    }
    this.group.add(rig.root);
  }

  /** Builds the walking graph: nodes in open floor, edges where the straight line is clear (and dry). */
  setGraph(points: [number, number][]) {
    this.nodes = points.map(([x, z]) => new THREE.Vector2(x, z));
    this.edges = linkRoutes(this.world, points);
  }

  /** The walking graph (for tests and debugging). */
  get graph(): { nodes: readonly THREE.Vector2[]; edges: readonly (readonly number[])[] } {
    return { nodes: this.nodes, edges: this.edges };
  }

  graphInfo() {
    return { nodes: this.nodes.length, edges: this.edges.reduce((a, e) => a + e.length, 0) / 2, isolated: this.edges.filter((e) => e.length === 0).length };
  }

  /** A random walking-graph node (optionally only where `ok`: the floor's wanderers stay off the Promenade). */
  randomNode(ok?: (x: number, z: number) => boolean): THREE.Vector3 {
    const list = ok ? this.nodes.filter((n) => ok(n.x, n.y)) : this.nodes;
    const n = (list.length ? list : this.nodes)[Math.floor(rnd() * (list.length || this.nodes.length))];
    return new THREE.Vector3(n.x, 0, n.y);
  }

  /** Sends a walker (a waiter back to the bar) the shortest way to the walkable spot nearest (x, z). */
  headTo(p: Person, x: number, z: number): boolean {
    if (this.nodes.length === 0) return false;
    if (p.target === null) p.target = this.nearestNode(p.pos.x, p.pos.z);
    const path = pathTo(this.edges, p.target, this.nearestNode(x, z));
    if (!path) return false;
    p.route = path;
    return true;
  }

  private nearestNode(x: number, z: number) {
    let best = 0,
      bd = Infinity;
    this.nodes.forEach((n, i) => {
      const d = (n.x - x) ** 2 + (n.y - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Makes everyone near a point react: cheer (big win) or gasp. */
  react(at: THREE.Vector3, radius: number, kind: 'cheer' | 'gasp') {
    for (const p of this.people) {
      if (p.role === 'croupier' || p.pos.distanceTo(at) > radius) continue;
      if (kind === 'cheer') p.cheer = 1.6 + Math.random() * 0.6;
      else p.gaspT = 1.0;
    }
  }

  /** Behind walls from where you are (set by the frame loop's portal culling): not drawn or posed. */
  occluded: ((pos: THREE.Vector3) => boolean) | null = null;

  /** Where your feet were at the last update (for guests who keep out of your way). */
  readonly playerAt = new THREE.Vector3();

  update(dt: number, time: number, player: THREE.Vector3, playerHead: THREE.Vector3) {
    this.time = time;
    this.playerAt.copy(player);
    let trayN = 0;
    this.updateTalks(time);
    let gi = 0,
      ph = 0;
    this.people.forEach((p, i) => {
      if (p.away) {
        // Somewhere else: nothing to draw or animate (whoever sent them away brings them back).
        if (!p.culled) {
          p.culled = true;
          if (p.rig) p.rig.root.visible = false;
        }
        this.shadowMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        p.onUpdate?.(p, dt);
        return;
      }
      const fighting = p.fight !== null && !p.driven;
      if (!fighting) {
        p.onUpdate?.(p, dt);
        if (p.role === 'wander' || p.role === 'waiter') this.walk(p, dt, player);
        else if (p.role === 'pair') this.walkBeside(p, dt);
      }
      p.blush = Math.max(0, p.blush - dt);
      if (p.fight) p.fight.hitT += dt;
      if (p.snapX !== 0 || p.snapY !== 0) {
        const k = Math.max(0, 1 - dt * 5);
        p.snapX = Math.abs(p.snapX) < 0.003 ? 0 : p.snapX * k;
        p.snapY = Math.abs(p.snapY) < 0.003 ? 0 : p.snapY * k;
      }
      p.cheer = Math.max(0, p.cheer - dt);
      p.dabT = Math.max(0, p.dabT - dt);
      p.gaspT = Math.max(0, p.gaspT - dt);
      p.laughT = Math.max(0, p.laughT - dt);
      if (p.action > 0) p.action = Math.max(0, p.action - dt);
      else p.actionKind = 'none';
      // Drinks get sipped now and then.
      if (p.prop === 'glass') {
        p.sipT = Math.max(0, p.sipT - dt);
        p.nextSip -= dt;
        if (p.nextSip <= 0 && p.talking < 0.5) {
          p.sipT = 1.6;
          p.nextSip = 8 + Math.random() * 14;
        }
      }

      if (p.driven) {
        if (p.rig) this.poseRig(p, i, dt, 0);
        else this.pose(p, i, time);
        return;
      }
      const toP = this.v.set(playerHead.x - p.pos.x, 0, playerHead.z - p.pos.z);
      const dist = toP.length();
      // Far away on a headset or phone: not drawn at all (the crowd still moves).
      // (Never across the resort: the Promenade and the suite are hundreds of metres from the floor.)
      const cull = (dist > this.cullDist || dist > FAR_CULL || (this.occluded !== null && this.occluded(p.pos))) && p.role !== 'buddy';
      if (cull !== p.culled) {
        p.culled = cull;
        if (p.rig) p.rig.root.visible = !cull;
      }
      if (cull) {
        this.shadowMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        return;
      }

      // Where they look: what they're doing, not you. A curious few glance at
      // you briefly when you come close in front of them; staff look up when
      // you're at their game.
      let [wantYaw, wantPitch] = this.activityGaze(p, time);
      let rel = Math.atan2(toP.x, toP.z) - p.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const staff = p.role === 'croupier' || p.role === 'bartender' || p.role === 'waiter';
      p.glanceCd -= dt;
      if (time > p.glanceUntil && p.glanceCd <= 0 && dist < 2.6 && Math.abs(rel) < 0.9 && (p.curious || staff) && p.role !== 'pianist' && !p.photo) {
        p.glanceUntil = time + 0.9 + Math.random() * 1.3;
        p.glanceCd = staff ? 6 + Math.random() * 6 : 14 + Math.random() * 20;
      }
      if (time < p.attendUntil) {
        wantYaw = THREE.MathUtils.clamp(rel, -1.25, 1.25);
        wantPitch = THREE.MathUtils.clamp(Math.atan2(playerHead.y - (p.pos.y + (p.seated ? 1.2 : 1.6)), Math.max(dist, 0.3)), -0.4, 0.4);
      } else if (time < p.glanceUntil && dist < 3.5) {
        wantYaw = THREE.MathUtils.clamp(rel, -1.0, 1.0);
        wantPitch = THREE.MathUtils.clamp(Math.atan2(playerHead.y - (p.pos.y + (p.seated ? 1.2 : 1.6)), dist), -0.35, 0.35);
      }
      p.headYaw += (wantYaw - p.headYaw) * Math.min(1, dt * 3);
      p.headPitch += (wantPitch - p.headPitch) * Math.min(1, dt * 3);
      if (p.rig) this.poseRig(p, i, dt, dist);
      else this.pose(p, i, time);
      if (p.role === 'waiter' && !p.rig && trayN < this.trays.instanceMatrix.count) {
        this.trays.setMatrixAt(trayN++, this.trayMatrix);
      }
      if (p.prop !== 'none' && p.rig) {
        const m = this.propMatrix(p);
        if (m) {
          if (p.prop === 'glass') {
            this.glassOwners[gi] = p;
            this.glasses.setMatrixAt(gi++, m);
          }
          else this.phones.setMatrixAt(ph++, m);
        }
      }
    });
    this.trays.count = trayN;
    this.trays.instanceMatrix.needsUpdate = trayN > 0;
    this.glasses.count = gi;
    this.glassOwners.length = gi;
    this.glasses.instanceMatrix.needsUpdate = gi > 0;
    // They move: clicks find them where they are now.
    this.glasses.boundingSphere = null;
    this.phones.count = ph;
    this.phones.instanceMatrix.needsUpdate = ph > 0;
    for (const part of Object.values(this.parts)) part.mesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  /** Head direction (relative yaw, pitch) for whatever this person is busy with. */
  private activityGaze(p: Person, time: number): [number, number] {
    const idle = Math.sin(time * 0.3 + p.seed) * 0.3;
    const at = (q: THREE.Vector3, dy = 0): [number, number] => {
      let r = Math.atan2(q.x - p.pos.x, q.z - p.pos.z) - p.yaw;
      r = Math.atan2(Math.sin(r), Math.cos(r));
      return [THREE.MathUtils.clamp(r, -1.1, 1.1), dy];
    };
    if (p.photo) return [Math.sin(time * 0.4 + p.seed) * 0.25, 0.45];
    if (p.talk) {
      const t = p.talk;
      const speaker = t.members[t.speaker];
      if (speaker && speaker !== p) return at(speaker.pos, 0.02);
      // The one talking looks around the circle.
      const others = t.members.filter((m) => m !== p);
      const o = others[Math.floor((time * 0.4 + p.seed) % others.length)] ?? others[0];
      return o ? at(o.pos, 0.02) : [idle, 0];
    }
    if (p.chatWith) return at(p.chatWith.pos);
    if (p.follow) {
      // Chat with your friend as you walk: mostly ahead, sometimes at them.
      return Math.sin(time * 0.5 + p.seed) > 0.4 ? at(p.follow.pos) : [idle * 0.5, -0.05];
    }
    if (p.role === 'slots') return [idle * 0.3, -0.15];
    if (p.role === 'croupier') return [idle * 0.4, -0.3];
    if (p.role === 'patron' || p.role === 'watch') return [idle * 0.6, -0.15];
    return [idle, 0];
  }

  /** Conversations: turn taking, and the occasional shared laugh. */
  private updateTalks(time: number) {
    for (const t of this.talks) {
      if (time > t.nextTurn && time > (t.scriptUntil ?? 0)) {
        const n = t.members.length;
        t.speaker = (t.speaker + 1 + Math.floor(Math.random() * (n - 1))) % n;
        t.nextTurn = time + 2.5 + Math.random() * 4.5;
        if (Math.random() < 0.28) {
          t.laughUntil = time + 1.4;
          for (const m of t.members) m.laughT = 1.2 + Math.random() * 0.4;
        }
      }
      t.members.forEach((m, k) => {
        const want = k === t.speaker && time > t.laughUntil ? 1 : 0;
        m.talking += (want - m.talking) * 0.08;
      });
    }
    // Two strangers-turned-friends stopped mid-walk, and anyone saying a line.
    for (const p of this.people) {
      if (time < p.speakUntil && !p.talk) {
        p.talking += (1 - p.talking) * 0.15;
        continue;
      }
      if (!p.chatWith) continue;
      p.talking = 0.5 + 0.5 * Math.sin(time * 0.9 + p.seed);
    }
  }

  /** Keeps a companion walking beside their friend (or waiting with them). */
  private walkBeside(p: Person, dt: number) {
    const lead = p.follow;
    if (!lead) return;
    const side = new THREE.Vector3(Math.cos(lead.yaw), 0, -Math.sin(lead.yaw)).multiplyScalar(lead.moving > 0.1 ? 0.62 : 0.75);
    const tx = lead.pos.x + side.x - Math.sin(lead.yaw) * (lead.moving > 0.1 ? 0.05 : -0.1),
      tz = lead.pos.z + side.z - Math.cos(lead.yaw) * (lead.moving > 0.1 ? 0.05 : -0.1);
    const dx = tx - p.pos.x,
      dz = tz - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 6) {
      p.pos.set(tx, 0, tz);
      return;
    }
    const want = d < 0.12 ? 0 : Math.min(2.2, lead.moving + d * 1.5);
    p.moving += (want - p.moving) * Math.min(1, dt * 5);
    if (p.moving > 0.02 && d > 0.02) {
      const step = Math.min(d, p.moving * dt);
      const nx = p.pos.x + (dx / d) * step,
        nz = p.pos.z + (dz / d) * step;
      if ((this.world.isFree(nx, nz, 0.2, true) && dry(this.world, nx, nz, 0.12)) || !this.world.isFree(p.pos.x, p.pos.z, 0.2, true)) {
        p.pos.x = nx;
        p.pos.z = nz;
      }
      p.walkPhase += p.moving * dt * 5.2;
    }
    // Face where the pair is going; when stopped, turn a little toward the friend.
    let ty = lead.yaw;
    if (lead.moving < 0.1) ty = Math.atan2(lead.pos.x - p.pos.x, lead.pos.z - p.pos.z) * 0.5 + lead.yaw * 0.5;
    let dy = ty - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * Math.min(1, dt * 4);
    p.talking = lead.moving < 0.1 ? 0.6 + 0.4 * Math.sin(this.time * 0.7 + p.seed) : 0.15;
  }

  private propV = new THREE.Vector3();
  private propQ = new THREE.Quaternion();
  /** Where the drink in someone's hand is (world), or null (none, not drawn, no hand). */
  glassAt(p: Person, out = new THREE.Vector3()): THREE.Vector3 | null {
    if (p.prop !== 'glass' || !p.rig || p.culled) return null;
    const m = this.propMatrix(p);
    return m ? out.setFromMatrixPosition(m).add(this.v.set(0, 0.05, 0)) : null;
  }

  /** World matrix for the drink or phone in someone's right hand. */
  private propMatrix(p: Person): THREE.Matrix4 | null {
    const b = p.rig!.bones;
    const wrist = b['WristR'] ?? b['HandR'];
    if (!wrist) return null;
    wrist.updateWorldMatrix(true, false);
    const pos = this.propV.set(0, 0.07, 0.03).applyMatrix4(wrist.matrixWorld);
    if (p.prop === 'glass') {
      // Upright, tipped toward the mouth while sipping.
      const tip = p.sipT > 0 ? Math.sin(Math.min(1, (1.6 - p.sipT) / 1.6) * Math.PI) * 0.9 : 0;
      this.propQ.setFromEuler(this.e.set(-tip, p.yaw, 0, 'YXZ'));
      return this.m.compose(pos.add(new THREE.Vector3(0, -0.02, 0)), this.propQ, this.s.set(1, 1, 1)).clone();
    }
    // Phone held up, screen toward the person.
    this.propQ.setFromEuler(this.e.set(-0.25, p.yaw, 0, 'YXZ'));
    return this.m.compose(pos, this.propQ, this.s.set(1, 1, 1)).clone();
  }

  /** Somewhere to head for: anywhere, or mostly where they like to be. */
  private pickGoal(p: Person): number {
    const any = Math.floor(Math.random() * this.nodes.length);
    if (!p.haunt || Math.random() < 0.25) return any;
    const liked = this.nodes.map((n, i) => (p.haunt!(n.x, n.y) ? i : -1)).filter((i) => i >= 0);
    return liked.length ? liked[Math.floor(Math.random() * liked.length)] : any;
  }

  private walk(p: Person, dt: number, player: THREE.Vector3) {
    if (this.nodes.length === 0) return;
    if (p.target === null) p.target = this.nearestNode(p.pos.x, p.pos.z);
    p.chatCd -= dt;
    if (p.pause > 0) {
      p.pause -= dt;
      p.moving += (0 - p.moving) * Math.min(1, dt * 6);
      if (p.chatWith) {
        // Face the friend you bumped into.
        let dy = Math.atan2(p.chatWith.pos.x - p.pos.x, p.chatWith.pos.z - p.pos.z) - p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        p.yaw += dy * Math.min(1, dt * 3);
        if (p.pause <= 0) {
          p.chatWith = null;
          p.talking = 0;
        }
      }
      return;
    }
    // Passing someone you know? Stop for a quick chat now and then.
    if (p.role === 'wander' && p.chatCd <= 0) {
      p.chatCd = 2 + Math.random() * 2;
      for (const o of this.people) {
        if (o === p || o.role !== 'wander' || o.pause > 0 || o.chatCd > 0 || o.follow) continue;
        if (Math.abs(o.pos.x - p.pos.x) > 1.4 || Math.abs(o.pos.z - p.pos.z) > 1.4) continue;
        if (Math.random() < 0.25) {
          const t = 4 + Math.random() * 5;
          p.pause = o.pause = t;
          p.chatWith = o;
          o.chatWith = p;
          p.chatCd = o.chatCd = 40 + Math.random() * 40;
        } else p.chatCd = 15 + Math.random() * 15;
        break;
      }
    }
    const t = this.nodes[p.target];
    const dx = t.x - p.pos.x,
      dz = t.y - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      // Now and then a guest sets off for somewhere else in the resort (out to the
      // pool, back to the tables) and walks the shortest way there; otherwise they amble.
      if (p.route.length === 0 && p.role === 'wander' && Math.random() < 0.08) p.route = pathTo(this.edges, p.target, this.pickGoal(p)) ?? [];
      const options = this.edges[p.target].filter((n) => n !== p.prev);
      const list = options.length ? options : this.edges[p.target];
      p.prev = p.target;
      const next = p.route.shift();
      p.target = next !== undefined && this.edges[p.target].includes(next) ? next : list.length ? list[Math.floor(Math.random() * list.length)] : p.target;
      if (next !== undefined && p.target !== next) p.route = [];
      if (Math.random() < 0.18) p.pause = 1.5 + Math.random() * 3.5;
      return;
    }
    // Make way for the player: stop if they are right in front.
    const px = player.x - p.pos.x,
      pz = player.z - p.pos.z;
    const pd = Math.hypot(px, pz);
    const ahead = (px * dx + pz * dz) / (d * Math.max(pd, 1e-3));
    let want = p.speed;
    if (pd < 1.1 && ahead > 0.5) want = 0;
    else if (pd < 2 && ahead > 0.6) want = p.speed * 0.5;
    p.moving += (want - p.moving) * Math.min(1, dt * 4);
    const step = Math.min(d, p.moving * dt);
    let nx = p.pos.x + (dx / d) * step,
      nz = p.pos.z + (dz / d) * step;
    // Keep a little personal space between guests.
    for (const o of this.people) {
      if (o === p) continue;
      const ox = nx - o.pos.x,
        oz = nz - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 0.55 && od > 1e-3) {
        nx += (ox / od) * (0.55 - od) * 0.5;
        nz += (oz / od) * (0.55 - od) * 0.5;
      }
    }
    // Stay out of furniture and the pool (anyone shoved off the path walks back out).
    if ((this.world.isFree(nx, nz, 0.22, true) && dry(this.world, nx, nz, 0.12)) || !this.world.isFree(p.pos.x, p.pos.z, 0.22, true) || !dry(this.world, p.pos.x, p.pos.z, 0)) {
      p.pos.x = nx;
      p.pos.z = nz;
    }
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * Math.min(1, dt * 5);
    p.walkPhase += p.moving * dt * 5.2;
  }

  private trayMatrix = new THREE.Matrix4();

  /** Drives an animated character: blends clips by what the person is doing, then poses bones. */
  private poseRig(p: Person, i: number, dt: number, dist: number) {
    const rig = p.rig!;
    const female = (p.look.kind ?? '').startsWith('female');
    const sc = p.look.height / (female ? 1.72 : 1.82);
    // Up off the floor after a knockdown: they stand where the get-up left them.
    fightHandoff(p, rig);
    rig.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    rig.root.rotation.order = 'YXZ';
    rig.root.rotation.y = p.yaw;
    // Swimmers lie along the water, head up, legs kicking behind.
    const sb = p;
    sb.swimBlend += ((p.swimHead !== null ? 1 : 0) - sb.swimBlend) * Math.min(1, dt * 3);
    rig.root.rotation.x = 1.32 * sb.swimBlend;
    const down = p.fight ? p.fight.down : 0;
    if (p.fight && p.fight.wobble > 0 && p.fight.act === 'none') {
      // Groggy: swaying about the feet.
      const t = this.time + p.seed;
      rig.root.rotation.z = Math.sin(t * 1.7) * 0.06 * p.fight.wobble;
      rig.root.rotation.x = Math.sin(t * 1.1) * 0.04 * p.fight.wobble;
    } else rig.root.rotation.z = 0;
    if (sb.swimBlend > 0.01 && p.swimHead !== null) {
      const female = (p.look.kind ?? '').startsWith('female');
      const neck = 1.48 * (p.look.height / (female ? 1.72 : 1.82));
      const fx = Math.sin(p.yaw),
        fz = Math.cos(p.yaw);
      const k = sb.swimBlend;
      rig.root.position.x += (-fx * Math.sin(1.32) * neck) * k;
      rig.root.position.z += (-fz * Math.sin(1.32) * neck) * k;
      rig.root.position.y += (p.swimHead - 0.16 - Math.cos(1.32) * neck - rig.root.position.y) * k;
    }
    rig.root.scale.setScalar(sc);
    // Far away people animate at a third of the rate (saves CPU on Quest and phones).
    p.animDt += dt;
    const every = dist > 14 ? 3 : dist > 8 ? 2 : 1;
    if (++p.animSkip % every !== 0 && !p.seated) {
      this.shadowAt(p, i, sc);
      return;
    }
    const step = p.animDt;
    p.animDt = 0;
    const a = rig.actions;
    const mv = p.seated ? 0 : p.swimHead !== null ? Math.max(p.moving, 0.9) : p.moving;
    const run = THREE.MathUtils.clamp((mv - 1.9) / 0.6, 0, 1);
    const walk = THREE.MathUtils.clamp(mv / 0.6, 0, 1) * (1 - run);
    const cheer = p.cheer > 0 ? Math.min(1, p.cheer * 3) : 0;
    const gasp = p.gaspT > 0 ? Math.min(1, p.gaspT * 3) : 0;
    const busy =
      (p.role === 'pianist' && p.seated) || (p.role !== 'slots' && p.action > 0 && p.actionKind !== 'none' && p.actionKind !== 'offer') ? 1 : 0;
    // A fight's clips (fightanim.ts) take what they need of the body; the ordinary clips get the rest.
    const fightW = this.lib && !p.seated ? fightMix(p, rig, this.lib.clips, step) : 0;
    // As do the headliner's stage moves (party/showanim.ts).
    const showW = this.lib && !p.seated && (p.show || rig.root.userData.showAnim) ? showMix(p, rig, this.lib.clips, step) : 0;
    const fw = Math.min(1, fightW + showW);
    const over = Math.max(cheer, gasp * (1 - fw), busy * 0.9) * (1 - fw);
    const baseW = (1 - over) * (1 - fw);
    const w = (name: string, v: number) => a[name]?.setEffectiveWeight(v);
    w('Idle_Neutral', baseW * (1 - walk - run) * 0.7);
    w('Idle', baseW * (1 - walk - run) * 0.3);
    w('Walk', baseW * walk);
    w('Run', baseW * run);
    w('Wave', cheer * (1 - fw));
    w('HitRecieve', gasp * (1 - cheer) * (1 - fw));
    w('Interact', busy * (1 - cheer) * 0.9 * (1 - fw));
    if (a.Walk) a.Walk.timeScale = THREE.MathUtils.clamp(mv / (1.15 * sc), 0.5, 1.6);
    if (a.Run) a.Run.timeScale = THREE.MathUtils.clamp(mv / (3.2 * sc), 0.6, 1.4);
    if (a.Interact) a.Interact.timeScale = p.role === 'pianist' ? 1.6 : 1;
    rig.mixer.update(step);

    const b = rig.bones;
    if (p.seated) {
      // Sit: lower the hips onto the seat, then place the legs with IK (thighs along
      // the seat, knees forward, feet on the floor or the stool's footrest). IK works
      // for every character model, whatever its leg bones' local axes.
      rig.root.position.y = p.seatY - POSE.sitHips * sc;
      if (p.lie > 0) this.recline(p);
      else {
        rig.root.updateMatrixWorld(true);
        sitLegs(b, p.yaw, p.pos.y);
      }
    } else if (fw < 0.01) {
      // A rig that sat before (pooled rigs) gets its feet back under it.
      standLegs(b);
    }
    // Social overlays: talking hands, a drink or phone in hand, laughing.
    if (!p.seated && walk + run < 0.5 && cheer < 0.3 && fw < 0.05 && down === 0) {
      const t = this.time + p.seed;
      const still = 1 - Math.min(1, (walk + run) * 2);
      if (p.talking > 0.05) {
        // Hands that talk: the free hand (and both when no drink) move with the words.
        const k = p.talking * still;
        const gl = (0.35 + 0.3 * Math.sin(t * 3.1)) * k,
          gr = (0.3 + 0.35 * Math.sin(t * 2.3 + 1.7)) * k;
        b['UpperArmL']?.rotateX(gl * 0.9);
        b['LowerArmL']?.rotateX(0.6 * k + gl * 0.8);
        if (p.prop === 'none') {
          b['UpperArmR']?.rotateX(gr * 0.9);
          b['LowerArmR']?.rotateX(0.6 * k + gr * 0.8);
        }
        b.Head?.rotateX(Math.sin(t * 4.2) * 0.05 * k);
      }
      if (p.prop === 'glass') {
        const sip = p.sipT > 0 ? Math.sin(Math.min(1, (1.6 - p.sipT) / 1.6) * Math.PI) : 0;
        b['UpperArmR']?.rotateX((POSE.trayUpper * 0.45 + sip * 0.55) * still);
        b['LowerArmR']?.rotateX((POSE.trayLower * 0.95 + sip * 0.75) * still);
        if (sip > 0.1) b.Head?.rotateX(-sip * 0.18);
      } else if (p.prop === 'phone') {
        const up = p.photo ? 1 : 0.55;
        b['UpperArmR']?.rotateX((0.9 + 0.5 * up) * still);
        b['LowerArmR']?.rotateX((1.0 - 0.3 * up) * still);
      }
      if (p.laughT > 0) {
        const l = Math.min(1, p.laughT * 2) * still;
        rig.root.position.y += Math.abs(Math.sin(t * 14)) * 0.012 * l;
        b.Head?.rotateX(-0.22 * l);
        b['Spine']?.rotateX(-0.06 * l);
      }
    }
    if (p.tray) this.carryTray(p);
    // Look at the player / glance around.
    // (Not while out cold or getting up off the floor.)
    const look = p.fight && (p.fight.act === 'ko' || p.fight.act === 'getup') ? 0 : 1;
    b.Head?.rotateY(p.headYaw * 0.8 * look);
    b.Head?.rotateX(-p.headPitch * look);
    if (p.snapX !== 0 || p.snapY !== 0) {
      // Knocked back by a punch (or turned by a slap).
      b.Head?.rotateX(-p.snapX);
      b.Head?.rotateY(p.snapY);
      b.Neck?.rotateX(-p.snapX * 0.5);
      b.Neck?.rotateY(p.snapY * 0.4);
    }
    if (p.fight && fightW > 0.01) {
      rig.root.updateMatrixWorld(true);
      fightAim(p, rig, sc);
    }
    if (p.onPose) {
      rig.root.updateMatrixWorld(true);
      p.onPose(p);
    }
    this.shadowAt(p, i, sc);
    if (p.proxy) p.proxy.position.set(p.pos.x, 1.0, p.pos.z);
  }

  private hipV = [new THREE.Vector3(), new THREE.Vector3()];
  /**
   * Lying back on a lounger: tips the whole body back by `p.lie` about the hips,
   * puts the hips on the seat (just behind pos, where the backrest starts),
   * stretches the legs out along the cushion and tilts the head up to look
   * down the body at the pool.
   */
  private recline(p: Person) {
    const rig = p.rig!,
      b = rig.bones;
    rig.root.rotation.x = -p.lie;
    rig.root.updateMatrixWorld(true);
    const [l, r] = this.hipV;
    const ul = b['UpperLegL'],
      ur = b['UpperLegR'];
    if (ul && ur) {
      ul.getWorldPosition(l);
      ur.getWorldPosition(r);
      l.add(r).multiplyScalar(0.5);
      const back = 0.1;
      rig.root.position.x += p.pos.x - Math.sin(p.yaw) * back - l.x;
      rig.root.position.y += p.pos.y + p.seatY - l.y;
      rig.root.position.z += p.pos.z - Math.cos(p.yaw) * back - l.z;
      rig.root.updateMatrixWorld(true);
    }
    lieLegs(b, p.yaw, p.pos.y + p.seatY - 0.1);
    // Chin down a little: looking along the body at the pool, not at the stars.
    b.Head?.rotateX(p.lie * 0.45);
  }

  private tv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private static UP = new THREE.Vector3(0, 1, 0);
  private static FLAT = [0.05, 0, 0, 0, 0];
  private static FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
  private static STRAIGHT = [0, 0, 0.12, 0.14, 0.1];

  /**
   * A server's carry, posed fresh every frame after the clips run: the right
   * arm starts from its bind pose (nothing the walk, idle or wave clips did to
   * it survives), the elbow hangs low by the side, the forearm comes forward and
   * up so the hand is open, flat and palm up in front of the chest, and the tray
   * rides on that hand. The tray is a child of the wrist bone, placed once on
   * top of the palm (measured from the character's own skinned hand, so it fits
   * every model): hand and tray can't drift apart or pass through each other,
   * on any frame, including the ones far-away people skip.
   */
  private carryTray(p: Person) {
    const rig = p.rig!,
      b = rig.bones,
      tray = p.tray!;
    const up = b['UpperArmR'],
      lo = b['LowerArmR'],
      wr = b['WristR'],
      // Middle1 is the metacarpal (it starts at the wrist); Middle2 starts at the knuckle.
      mid = b['Middle2R'] ?? b['Middle1R'];
    if (!up || !lo || !wr || !mid) return;
    for (const bn of [up, lo, wr]) {
      const r = bn.userData.carryRest as THREE.Quaternion | undefined;
      if (r) bn.quaternion.copy(r);
    }
    rig.root.updateMatrixWorld(true);
    const [S, E, W, T, F, R] = this.tv;
    up.getWorldPosition(S);
    lo.getWorldPosition(E);
    wr.getWorldPosition(W);
    const L = S.distanceTo(E) + E.distanceTo(W);
    const fwd = F.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const right = R.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
    // The hand: in front of the shoulder and a little out, at chest height.
    T.copy(S).addScaledVector(fwd, CARRY.fwd * L).addScaledVector(right, CARRY.out * L);
    T.y -= CARRY.down * L;
    // The elbow hangs down by the side, a touch out and back.
    const pole = E.copy(S).addScaledVector(right, 0.25).addScaledVector(fwd, -0.12);
    pole.y -= 0.8;
    reach(up, lo, wr, T, pole, 1);
    this.flatHand(b);
    // Palm up, pointing ahead (turned in a little, as hands go), knuckles level.
    const point = T.copy(fwd).addScaledVector(right, -0.25).normalize();
    orientHand(b, 'R', point, Crowd.UP);
    this.levelHand(b, point, right);
    if (!tray.userData.onHand || tray.parent !== wr) {
      // Once: find the top of the open hand (skin, not bones) over the palm's middle
      // and seat the tray there, on the wrist.
      rig.root.updateMatrixWorld(true);
      rig.mesh?.skeleton.update();
      wr.getWorldPosition(W);
      mid.getWorldPosition(S);
      const cx = (W.x + S.x) / 2,
        cz = (W.z + S.z) / 2;
      const top = this.handTop(p, cx, cz, Math.max(W.y, S.y));
      const c = T.set(cx, top + TRAY_UNDER + 0.004, cz);
      wr.add(tray);
      wr.worldToLocal(c);
      tray.position.copy(c);
      tray.userData.onHand = true;
    }
    // Level, square to the body, and real size (whatever the bone's scale).
    wr.getWorldQuaternion(this.lq[2]);
    tray.quaternion.setFromAxisAngle(Crowd.UP, p.yaw).premultiply(this.lq[2].invert());
    wr.getWorldScale(W);
    tray.scale.set(1 / W.x, 1 / W.y, 1 / W.z);
    tray.updateMatrixWorld(true);
  }

  /** The right hand open and flat (every finger joint from its rest pose: nothing builds up). */
  private flatHand(b: Record<string, THREE.Object3D>) {
    setFingers(b, 'R', Crowd.FLAT);
    // The rest pose curls the fingers a little: straighten them out flat under the tray.
    for (const f of Crowd.FINGERS)
      for (let seg = 2; seg <= 4; seg++) {
        const bn = b[f + seg + 'R'];
        if (!bn) continue;
        if (seg === 4) bn.quaternion.copy((bn.userData.rest ??= bn.quaternion.clone().normalize()) as THREE.Quaternion);
        bn.rotateX(-FINGER.sign.R * Crowd.STRAIGHT[seg]);
      }
  }

  /** A round silver tray with a rim; its top surface is at y = 0 (drinks stand on it there). */
  private makeTray(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9c08a, metalness: 0.9, roughness: 0.25 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(TRAY_R, TRAY_R - 0.01, TRAY_UNDER, 28).translate(0, -TRAY_UNDER / 2, 0), mat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TRAY_R - 0.003, 0.006, 6, 36).rotateX(Math.PI / 2), mat);
    rim.position.y = 0.002;
    g.add(disc, rim);
    g.name = 'tray';
    // It moves with her: thrown things knock off it, they don't land on it.
    g.userData.loose = true;
    return g;
  }

  private lq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private hv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private lm = [new THREE.Matrix4(), new THREE.Matrix4()];
  /**
   * Turns the right hand so it lies level, palm up: the knuckles (index to
   * pinky) horizontal and the hand pointing along `point`. Measured from the
   * knuckles rather than the metacarpals, which start right at the wrist and
   * give a poor frame on some models.
   */
  private levelHand(b: Record<string, THREE.Object3D>, point: THREE.Vector3, right: THREE.Vector3) {
    const wr = b['WristR'],
      m = b['Middle2R'],
      ix = b['Index2R'],
      pk = b['Pinky2R'];
    if (!wr || !m || !ix || !pk) return;
    // Scratch of its own: `point` and `right` are the caller's scratch vectors (sharing
    // them flipped the hand palm-down on some frames, through the tray).
    const [W, M, I, P] = this.hv;
    wr.getWorldPosition(W);
    m.getWorldPosition(M);
    ix.getWorldPosition(I);
    pk.getWorldPosition(P);
    const basis = (f: THREE.Vector3, across: THREE.Vector3, out: THREE.Matrix4) => {
      const z = f.normalize();
      const x = across.addScaledVector(z, -across.dot(z)).normalize();
      const y = P.crossVectors(z, x);
      return out.makeBasis(x, y, z);
    };
    // Current frame (fingers' direction, knuckles' line) ...
    const cur = basis(M.sub(W), I.sub(P), this.lm[0]);
    const qc = this.lq[0].setFromRotationMatrix(cur);
    // ... and the wanted one: pointing ahead, knuckles level with the index toward the
    // outside (a right hand turned palm up has its thumb on the outside).
    W.copy(point);
    W.y = 0;
    I.copy(right);
    const want = basis(W, I, this.lm[1]);
    const delta = this.lq[1].setFromRotationMatrix(want).multiply(qc.invert());
    const qw = wr.getWorldQuaternion(this.lq[2]).premultiply(delta);
    if (wr.parent) qw.premultiply(wr.parent.getWorldQuaternion(this.lq[0]).invert());
    wr.quaternion.copy(qw).normalize();
    wr.updateMatrixWorld(true);
  }

  /**
   * Highest point of the right hand and wrist (skinned vertices) within the
   * tray's footprint around (cx, cz). Falls back to the bones' height + a palm.
   */
  private handTop(p: Person, cx: number, cz: number, boneY: number): number {
    const rig = p.rig!;
    const mesh = rig.mesh;
    if (!mesh) return boneY + 0.02;
    let idx = rig.root.userData.handVerts as Uint32Array | undefined;
    if (!idx) {
      const bones = mesh.skeleton.bones;
      const hand = new Set<number>();
      bones.forEach((bn, k) => {
        const n = bn.name.replace(/\./g, '');
        if (/^(Wrist|Thumb\d|Index\d|Middle\d|Ring\d|Pinky\d)R$/.test(n) || n === 'LowerArmR') hand.add(k);
      });
      const si = mesh.geometry.attributes.skinIndex,
        sw = mesh.geometry.attributes.skinWeight;
      const list: number[] = [];
      for (let v = 0; v < si.count; v++) {
        let best = 0,
          bw = -1;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(v, k);
          if (w > bw) {
            bw = w;
            best = si.getComponent(v, k);
          }
        }
        if (hand.has(best)) list.push(v);
      }
      // A few dozen points are plenty to find the top of a low-poly hand.
      const step = Math.max(1, Math.floor(list.length / 90));
      idx = new Uint32Array(list.filter((_, k) => k % step === 0));
      rig.root.userData.handVerts = idx;
    }
    const v = this.tv[5];
    let top = -Infinity;
    for (let k = 0; k < idx.length; k++) {
      mesh.getVertexPosition(idx[k], v);
      v.applyMatrix4(mesh.matrixWorld);
      if ((v.x - cx) ** 2 + (v.z - cz) ** 2 > 0.16 * 0.16) continue;
      if (v.y > top) top = v.y;
    }
    return top > -Infinity ? top : boneY + 0.02;
  }

  private shadowAt(p: Person, i: number, sc: number) {
    this.v.set(p.pos.x, p.pos.y + 0.015, p.pos.z);
    this.shadowMesh.setMatrixAt(i, this.m.compose(this.v, this.q.identity(), this.s.set(sc, 1, sc)));
  }

  /** Writes every body part's matrix for one person. */
  private pose(p: Person, i: number, time: number) {
    this.pi = 0;
    const L = p.look;
    const sc = L.height / 1.75;
    const root = this.nm().compose(p.pos, this.q.setFromEuler(this.e.set(0, p.yaw, 0)), this.s.set(sc, sc, sc));
    const walk = Math.min(1, p.moving / 1.0);
    const ph = p.walkPhase;
    const swing = Math.sin(ph) * 0.48 * walk;
    const breathe = Math.sin(time * 1.6 + p.seed) * 0.01;
    const bounce = Math.abs(Math.cos(ph)) * 0.025 * walk;
    const cheer = p.cheer > 0 ? Math.min(1, p.cheer * 3, (2.2 - p.cheer) * 4) : 0;

    // --- Hips & legs
    const hipY = (p.seated ? p.seatY / sc : HIP_Y) + bounce;
    const hip = this.tmp.copy(root).multiply(this.m.makeTranslation(0, hipY, p.seated ? -0.05 : 0));
    const hipM = this.nm().copy(hip);
    for (const side of [-1, 1]) {
      const k = side < 0 ? 0 : 1;
      let thighA: number, kneeA: number;
      if (p.seated) {
        thighA = -1.45 + (p.role === 'pianist' ? Math.sin(time * 2 + side) * 0.03 : 0);
        kneeA = 1.35;
      } else {
        const s = swing * side;
        thighA = -s;
        kneeA = Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI) - 0.6)) * 0.7 * walk;
      }
      const thigh = this.nm().copy(hipM).multiply(this.m.makeTranslation(0.095 * side, 0, 0)).multiply(this.rot(thighA, 0, 0));
      this.set('thigh', i, k, thigh);
      const knee = this.nm().copy(thigh).multiply(this.m.makeTranslation(0, -THIGH, 0)).multiply(this.rot(kneeA, 0, 0));
      this.set('shin', i, k, knee);
      const ankle = this.nm().copy(knee).multiply(this.m.makeTranslation(0, -SHIN, 0)).multiply(this.rot(p.seated ? 0.1 : -kneeA * 0.3, 0, 0));
      this.set('shoe', i, k, ankle);
    }

    // --- Skirt (dresses only)
    if (L.dress) {
      const skirt = this.nm().copy(hipM).multiply(this.m.makeTranslation(0, 0.02, 0));
      if (p.seated) skirt.multiply(this.m.makeScale(1.15, 0.55, 1.35)).multiply(this.rot(-0.5, 0, 0));
      else skirt.multiply(this.rot(-swing * 0.12, 0, 0));
      this.set('skirt', i, 0, skirt);
    } else {
      this.set('skirt', i, 0, this.nm().makeScale(0, 0, 0));
    }

    // --- Torso
    const lean = p.role === 'slots' ? -0.12 : p.role === 'croupier' ? -0.08 : p.gaspT > 0 ? 0.08 : 0;
    const torso = this.nm().copy(hipM).multiply(this.rot(lean + breathe, Math.sin(ph) * 0.06 * walk, 0));
    this.set('torso', i, 0, torso);
    this.set('shirt', i, 0, L.dress ? this.nm().makeScale(0, 0, 0) : torso);
    const neck = this.nm().copy(torso).multiply(this.m.makeTranslation(0, TORSO - 0.02, 0));
    this.set('neck', i, 0, neck);
    const dab = dabWeight(p.dabT);
    const head = this.nm()
      .copy(neck)
      .multiply(this.m.makeTranslation(0, 0.05, 0))
      .multiply(this.rot(THREE.MathUtils.lerp(-p.headPitch - cheer * 0.25, DAB_HEAD[0], dab), THREE.MathUtils.lerp(p.headYaw, DAB_HEAD[1], dab), 0));
    this.set('head', i, 0, head);
    if (L.hairStyle === 'bald') this.set('hair', i, 0, this.nm().makeScale(0, 0, 0));
    else if (L.hairStyle === 'long') this.set('hair', i, 0, this.nm().copy(head).multiply(this.m.makeTranslation(0, -0.06, -0.01)).multiply(this.m.makeScale(1.05, 1.6, 1.08)));
    else if (L.hairStyle === 'bun') this.set('hair', i, 0, this.nm().copy(head).multiply(this.m.makeScale(1.0, 1.0, 1.12)));
    else this.set('hair', i, 0, head);

    // --- Arms
    for (const side of [-1, 1]) {
      const k = side < 0 ? 0 : 1;
      const right = side > 0;
      let ua = swing * side * 0.9, // forward swing (negative = forward)
        roll = 0.08 * side,
        fa = -0.25 - Math.abs(swing) * 0.3;
      const act = p.action > 0 ? Math.sin(Math.min(1, p.action) * Math.PI) : 0;
      switch (p.role) {
        case 'slots':
          ua = right ? -0.45 - act * 0.2 : -0.35;
          fa = right ? -0.75 + act * 0.25 : -0.9;
          roll = 0.15 * side;
          break;
        case 'patron':
          ua = right && p.actionKind === 'sip' ? -0.9 - act * 0.6 : -0.45;
          fa = right && p.actionKind === 'sip' ? -1.4 - act * 0.6 : -1.1;
          roll = 0.12 * side;
          break;
        case 'pianist':
          if (!p.seated) break;
          ua = -0.55;
          fa = -0.95;
          roll = 0.18 * side + Math.sin(time * (right ? 9 : 7) + p.seed) * 0.06;
          break;
        case 'croupier':
          if (p.actionKind === 'reach' && right) {
            ua = -1.0 - act * 0.25;
            fa = -0.4;
            roll = -0.35;
          } else {
            ua = -0.35;
            fa = -0.9;
            roll = 0.1 * side;
          }
          break;
        case 'bartender':
          if (p.actionKind === 'pour' && right) {
            ua = -1.5;
            fa = -0.4 + Math.sin(time * 4) * 0.05;
          } else if (p.actionKind === 'wipe' && right) {
            ua = -0.6 + Math.sin(time * 6) * 0.15;
            fa = -0.9;
            roll = -0.2 + Math.cos(time * 6) * 0.15;
          } else {
            ua = -0.25;
            fa = -0.7;
          }
          break;
        case 'waiter':
          if (right) {
            ua = -0.25;
            fa = -1.55;
            roll = 0.35;
          }
          break;
        case 'buddy':
          if (right && p.actionKind === 'sip') {
            ua = -0.9 - act * 0.6;
            fa = -1.4 - act * 0.6;
            break;
          }
          if (walk > 0.1) break;
          ua = right ? -0.12 : -0.15;
          fa = right ? -0.35 : -1.25;
          roll = right ? 0.1 : 0.32;
          break;
        case 'watch':
          if (!right) {
            ua = -0.15;
            fa = -1.2;
            roll = 0.3;
          } else {
            ua = -0.1;
            fa = -0.4;
          }
          break;
      }
      if (cheer > 0) {
        ua = THREE.MathUtils.lerp(ua, -2.7 + Math.sin(time * 14 + side) * 0.15, cheer);
        fa = THREE.MathUtils.lerp(fa, -0.3, cheer);
        roll = THREE.MathUtils.lerp(roll, 0.35 * side, cheer);
      }
      if (dab > 0) {
        const [dua, dfa, droll] = dabAngles(right, side);
        ua = THREE.MathUtils.lerp(ua, dua, dab);
        fa = THREE.MathUtils.lerp(fa, dfa, dab);
        roll = THREE.MathUtils.lerp(roll, droll, dab);
      } else if (cheer <= 0 && p.gaspT > 0) {
        const g = Math.min(1, p.gaspT * 3);
        ua = THREE.MathUtils.lerp(ua, -1.2, g);
        fa = THREE.MathUtils.lerp(fa, -1.6, g);
        roll = THREE.MathUtils.lerp(roll, -0.4 * side, g);
      }
      const shoulder = this.nm().copy(torso).multiply(this.m.makeTranslation(0.205 * side, TORSO - 0.07, 0)).multiply(this.rot(ua, 0, roll));
      this.set('upper', i, k, shoulder);
      const elbow = this.nm().copy(shoulder).multiply(this.m.makeTranslation(0, -UPPER, 0)).multiply(this.rot(fa, 0, 0));
      this.set('fore', i, k, elbow);
      const hand = this.nm().copy(elbow).multiply(this.m.makeTranslation(0, -FORE - 0.02, 0));
      this.set('hand', i, k, hand);
      if (p.role === 'waiter' && right) {
        this.trayMatrix.copy(hand).multiply(this.m.makeTranslation(0, 0.03, 0)).multiply(this.rot(-fa - ua, 0, -roll));
      }
    }

    // Contact shadow.
    this.v.set(p.pos.x, p.pos.y + 0.015, p.pos.z);
    this.shadowMesh.setMatrixAt(i, this.m.compose(this.v, this.q.identity(), this.s.set(sc, 1, sc)));
    if (p.proxy) {
      p.proxy.position.set(p.pos.x, 1.0, p.pos.z);
    }
  }

  private rot(x: number, y: number, z: number) {
    return this.nm().makeRotationFromEuler(this.e.set(x, y, z, 'YXZ'));
  }

  /** Scratch matrices reused every frame (no garbage, no GC hitches in VR). */
  private pool = Array.from({ length: 96 }, () => new THREE.Matrix4());
  private pi = 0;
  private nm() {
    return this.pool[this.pi++ % this.pool.length];
  }

  private set(name: string, i: number, k: number, m: THREE.Matrix4) {
    const part = this.parts[name];
    part.mesh.setMatrixAt(i * part.perPerson + k, m);
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [],
    nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
