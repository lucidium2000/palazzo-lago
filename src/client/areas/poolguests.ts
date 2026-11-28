import * as THREE from 'three';
import type { Person } from '../people';
import { poolLook, randomLook, staffLook } from '../people';
import { DECK, poolFloor, WATER_Y, type PoolArea } from './pool';
import { addConcertGoers, addPerformers, type Performers } from '../party/performers';
import { Crowd } from '../people';

const onDeck = (x: number, z: number) => x > DECK.x0 && x < DECK.x1 && z > DECK.z0 && z < DECK.z1;

/**
 * The pool party's guests: sunbathers lying back on the loungers, friends
 * standing waist-deep in the shallow end chatting, a couple of slow swimmers
 * doing loops in the deep end (who turn back rather than swim into you),
 * dancers on the floor by the DJ, drinkers at the pool bar and in the cabanas. Most wear
 * beachwear. Added before the floor's wanderers, most visible first, so a
 * smaller crowd (Quest, phones) keeps the best of it.
 */
export function populatePool(crowd: Crowd, pool: PoolArea, dancers: Person[] = [], performers?: Performers): Person[] {
  const people: Person[] = [];
  const keep = (p: Person | null) => {
    if (p) people.push(p);
    return p;
  };
  keep(crowd.add('bartender', staffLook('bar'), pool.bartender.pos, pool.bartender.yaw));
  // The DJ and the headliner (party/), before the guests fill the crowd.
  if (performers) {
    addPerformers(crowd, performers);
    keep(performers.dj);
    keep(performers.singer);
    for (const b of performers.band) keep(b);
  }

  // Waist-deep in the shallow end, chatting.
  const waders: Person[] = [];
  for (const s of pool.swimmers) {
    const p = keep(crowd.add('chat', poolLook(), s.pos, s.yaw));
    if (!p) break;
    if (waders.length === 0) p.prop = 'glass';
    // Shoved about, they still stand on the pool floor.
    p.onUpdate = (q) => {
      q.pos.y = poolFloor(q.pos.x, q.pos.z);
    };
    waders.push(p);
  }
  crowd.converse(waders);

  // Dancing on the LED floor in front of the DJ (party/index.ts makes them dance to the beat).
  pool.stands.forEach((s, k) => {
    const p = keep(crowd.add('watch', k % 2 ? poolLook() : randomLook(), s.pos, s.yaw));
    if (p) dancers.push(p);
  });
  // Her concert-goers, in the stage's own share of the crowd (away until she's on: party/audience.ts).
  // (The stage's whole share: more than the dancers they join, so the audience more than doubles.)
  if (performers) addConcertGoers(crowd, performers, Crowd.concertExtras(crowd.tierPeople), poolLook);

  // Slow loops in the deep end.
  pool.laps.forEach((lap, k) => {
    const a0 = k * Math.PI + 0.6;
    const p = keep(crowd.add('watch', poolLook(), new THREE.Vector3(lap.x + Math.cos(a0) * lap.rx, 0, lap.z + Math.sin(a0) * lap.rz)));
    if (p) p.onUpdate = swimmer(crowd, lap, a0, k === 0 ? 1 : -1);
  });

  // Sunbathers on the loungers (lying back; one sitting up), some with a drink or a phone.
  pool.loungers.forEach((s, k) => {
    const p = keep(crowd.add('patron', poolLook(), s.pos, s.yaw));
    if (!p) return;
    p.seatY = s.seatY;
    p.lie = s.lie;
    if (k % 3 === 1) p.prop = 'glass';
    else if (k === 4) p.prop = 'phone';
  });

  // Guests strolling round the deck (the walking graph takes them on to the lobby
  // and the casino too, and brings others out here).
  for (const [x, z] of STROLL) {
    const p = keep(crowd.add('wander', poolLook(), new THREE.Vector3(x, 0, z)));
    if (!p) continue;
    p.speed = 0.7 + Math.random() * 0.25;
    // They go inside now and then, but mostly come back out to the party.
    p.haunt = onDeck;
  }
  const [lead, friend] = crowd.addPair(new THREE.Vector3(31, 0, -20));
  if (lead) lead.haunt = onDeck;
  for (const p of [lead, friend]) if (p) keep(p);

  // Two friends by the hot tub.
  const pair = pool.chats.map((s) => keep(crowd.add('chat', poolLook(), s.pos, s.yaw))).filter((p): p is Person => !!p);
  crowd.converse(pair);
  // Pool bar stools and the cabanas.
  for (const s of [...pool.seats.slice(0, 4), ...pool.seats.slice(5, 9)]) {
    const p = keep(crowd.add('patron', poolLook(), s.pos, s.yaw));
    if (!p) break;
    p.seatY = s.seatY;
  }
  return people;
}

/** Where the deck's strollers start (walking-graph nodes on the deck). */
const STROLL: [number, number][] = [
  [36, -14.85],
  [46, -25.15],
  [55.5, -21.5],
  [37.1, -29.4],
  [42.3, -11],
];

/** Seconds a swimmer keeps going the other way after turning back from you. */
const TURN_COOL = 4;

/**
 * A swimmer going round an ellipse in the deep end at a lazy pace, head just
 * out of the water (people.ts lays the body flat behind it and kicks the legs).
 * When you're in the way ahead they turn round and swim back the other way.
 */
export function swimmer(crowd: Crowd, lap: PoolArea['laps'][number], a0: number, dir0: 1 | -1) {
  let a = a0,
    dir: number = dir0,
    cool = 0,
    pace = 1;
  return (p: Person, dt: number) => {
    cool = Math.max(0, cool - dt);
    const you = crowd.playerAt;
    // Where they'll be in about a second and a half.
    const ahead = a + (dir * lap.speed * 1.5) / Math.max(lap.rx, lap.rz);
    const ax = lap.x + Math.cos(ahead) * lap.rx,
      az = lap.z + Math.sin(ahead) * lap.rz;
    const close = Math.hypot(you.x - ax, you.z - az) < 1.3;
    if (close && cool <= 0) {
      dir = -dir;
      cool = TURN_COOL;
    }
    // Slow right down while you're near them at all.
    const near = Math.hypot(you.x - p.pos.x, you.z - p.pos.z) < 1.2;
    pace += ((near ? 0.25 : 1) - pace) * Math.min(1, dt * 2);
    a += (dir * lap.speed * pace * dt) / Math.hypot(lap.rx * Math.sin(a), lap.rz * Math.cos(a));
    const x = lap.x + Math.cos(a) * lap.rx,
      z = lap.z + Math.sin(a) * lap.rz;
    p.pos.set(x, poolFloor(x, z), z);
    // Face along the loop.
    const tx = -Math.sin(a) * lap.rx * dir,
      tz = Math.cos(a) * lap.rz * dir;
    const want = Math.atan2(tx, tz);
    let dy = want - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * Math.min(1, dt * 3);
    p.homeYaw = p.yaw;
    p.moving = lap.speed * pace;
    p.walkPhase += p.moving * dt * 5.2;
    // Head well up (breaststroke), shoulders at the surface.
    p.swimHead = WATER_Y + 0.2 + Math.sin(crowd.now * 2.1 + p.seed) * 0.025;
  };
}
