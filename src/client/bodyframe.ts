/**
 * Where your body is, from the headset alone (pure: unit-tested in
 * tests/bodyframe.test.ts).
 *
 * Facing: the headset's forward direction, flattened onto the floor, goes to
 * nothing as you look straight down (and flips past it), which used to spin
 * the body round so it hung in front of you. The top of your head points
 * forward when you look down (and back when you look up), so the facing is
 * the flattened forward plus the flattened up, signed by the pitch: it holds
 * steady at any pitch.
 *
 * Neck: the eyes sit in front of and above the neck's pivot, so nodding moves
 * them forward and down while the neck stays put. The body hangs from that
 * pivot (worked out from the head's pose), not from the eyes.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The neck's pivot in the head's frame: this far behind the eyes and below them (metres, at an average size). */
export const NECK_BACK = 0.09;
export const NECK_DOWN = 0.1;

/** Body yaw (person convention: atan2(x, z) of the facing) from the headset's forward and up directions. */
export function bodyYaw(dir: V3, up: V3): number {
  // Looking down (dir.y < 0) the head's top points forward; looking up it points back.
  const s = dir.y < 0 ? 1 : -1;
  const w = Math.min(1, Math.abs(dir.y) * 1.5);
  const x = dir.x + s * up.x * w;
  const z = dir.z + s * up.z * w;
  if (x * x + z * z < 1e-10) return Math.atan2(dir.x, dir.z);
  return Math.atan2(x, z);
}

/** Where the neck's pivot is, from the eyes' position and the head's forward and up directions (scaled by your size). */
export function neckPivot(head: V3, dir: V3, up: V3, scale = 1): V3 {
  return {
    x: head.x - (dir.x * NECK_BACK + up.x * NECK_DOWN) * scale,
    y: head.y - (dir.y * NECK_BACK + up.y * NECK_DOWN) * scale,
    z: head.z - (dir.z * NECK_BACK + up.z * NECK_DOWN) * scale,
  };
}
