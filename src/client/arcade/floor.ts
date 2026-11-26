import type * as THREE from 'three';
import type { Hands } from '../hands';
import type { Interaction } from '../interaction';
import type { Player, Viewpoint } from '../player';
import type { World } from '../world';
import type { DeskStation } from './desk';
import type { ArcadeAudio } from './synth';
import type { ArcadeFriend, ArcadeSession } from './net';
import type { CabinetMats } from './cabinet';
import type { RawPad } from './types';
import type { ControlInstances, TouchPoints } from './controls';
import type { KindDef } from '../loose';

/**
 * The room's loose objects (loose.ts), as far as the floor games use them:
 * the claw's prizes become real loose things (carried, thrown, put down and
 * seen in your hands by friends like anything else).
 */
export interface ArcadeLoose {
  /** New kinds of loose thing (every player's game adds the same, in the same order). */
  addKinds(defs: KindDef[]): void;
  /** Puts a new one into the world now (friends get it too, with the same id). */
  spawnLive(key: string, x: number, z: number, fromY: number, o?: { yaw?: number; paid?: boolean }): unknown;
  /** Tops loose things rest on. */
  surfaces: { boxIn(fx: number, fz: number, fyaw: number, lx: number, lz: number, w: number, d: number, y: number): void };
}

/**
 * The physical floor games (hoops, air hockey, the claw) share this shape:
 * they build into the arcade's baked root, take hands in VR or a desk pad on
 * a screen, and talk to friends through `arcF` messages.
 */

export interface FloorEnv {
  scene: THREE.Scene;
  bakeRoot: THREE.Group;
  liveRoot: THREE.Group;
  mats: CabinetMats;
  audio: ArcadeAudio;
  /** The shared instanced sticks and buttons. */
  inst: ControlInstances;
  /** This frame's VR fingertips and palms (gathered once a frame when near a machine). */
  touch: TouchPoints;
  hands: Hands;
  interaction: Interaction;
  player: Player;
  world: World;
  camera: THREE.Camera;
  /** Add world colliders for the game (false: the room already has them for the slot). */
  colliders: boolean;
  /** Charge a play ($1): true if paid. */
  pay(what: string): boolean;
  toast(text: string, kind?: 'info' | 'win' | 'warn'): void;
  /** Submit a score for this game's table. */
  submit?(game: string, initials: string, score: number): void;
  haptic(side: 'left' | 'right', strength: number, ms: number): void;
  /** Your name (shown to friends). */
  name(): string;
  /** Screens: step up to a floor game's spot (as walking up to it does). */
  sit?(game: string, spot: number): void;
  /** A light quality tier (Quest 2, phones): games run their screens at lower rates. */
  light?: boolean;
  /** The room's loose objects (won prizes go there), if it has them. */
  loose?: ArcadeLoose | null;
}

export interface FloorFrame {
  dt: number;
  t: number;
  feet: THREE.Vector3;
  inXR: boolean;
  /** This game's desk station is yours right now: the pad and which spot (viewpoint index). */
  desk: { pad: RawPad; spot: number; touch?: RawPad } | null;
  /** Metres from you to the game. */
  dist: number;
}

export interface FloorGame {
  readonly id: string;
  readonly title: string;
  readonly center: THREE.Vector3;
  /** Spots to stand at to play (desktop framing too), one per side. */
  readonly viewpoints: Viewpoint[];
  readonly desk: DeskStation;
  update(f: FloorFrame): void;
  /** The room's session changed (null: playing alone). */
  connect(s: ArcadeSession | null): void;
  /** A message for this game from a friend. */
  receive(from: ArcadeFriend, d: Record<string, unknown>): void;
  /** You stepped away from its desk spot. */
  leaveDesk?(): void;
  /** You left the arcade's floor (stop everything until update is called again). */
  sleep?(): void;
}

/** Sends a floor-game message (all floor games share the `arcF` kind, tagged with their id). */
export function floorEmit(s: ArcadeSession | null, game: string, d: Record<string, unknown>) {
  s?.emit('arcF', { ...d, g: game });
}
