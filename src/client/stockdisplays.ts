import * as THREE from 'three';
import { BOTTLES, type LooseObjects } from './loose';
import type { Lounge } from './lounge';
import { FOOD_LABEL, sodaCupGeometry } from './promenadeprops';
import type { DisplaySpec, PromenadeArea, PromenadeCast } from './areas/promenade';
import type { PoolArea } from './areas/pool';
import type { Give, SlotSpec, Stock } from './stock';

/**
 * What's on show where (stock.ts makes each one takeable): the Promenade's
 * food court, Bar Lago's back bar, the pool bar's lit column.
 */

type BottleName = keyof typeof BOTTLES;

/** The back bar's bottle colours (lounge.ts) and what's in each. */
const BACK_BAR: Record<number, BottleName> = {
  0x2a5a1a: 'champagne',
  0x6a3a0a: 'whisky',
  0xd8d0b0: 'tequila',
  0x8a1010: 'rum',
  0x1a2a4a: 'gin',
  0xc08a20: 'tequila',
  0x3a0a20: 'wine',
  0xe8e8f0: 'vodka',
};
/** The pool bar column's (pool.ts). */
const POOL_COLUMN: Record<number, BottleName> = { 0x2a6a3a: 'champagne', 0x8a5a1a: 'whisky', 0xd8d0c0: 'vodka', 0x3a1a4a: 'wine', 0x8a1a1a: 'rum' };

const bottle = (name: BottleName, glass: number): Give => ({ loose: 'bottle', color: glass, liquid: BOTTLES[name].liquid, name });

/** The nearest bottle in a colour table (instance colours come back as floats). */
function bottleFor(table: Record<number, BottleName>, c: THREE.Color): BottleName {
  let best: BottleName = 'vodka',
    bd = Infinity;
  for (const [hex, name] of Object.entries(table)) {
    const k = new THREE.Color(Number(hex));
    const dd = (k.r - c.r) ** 2 + (k.g - c.g) ** 2 + (k.b - c.b) ** 2;
    if (dd < bd) {
      bd = dd;
      best = name;
    }
  }
  return best;
}

export interface VenueStock {
  stock: Stock;
  loose: LooseObjects;
  lounge: Lounge;
  promenade: PromenadeArea | null;
  cast: () => PromenadeCast | null;
  pool: PoolArea | null;
}

export function setOutDisplays(v: VenueStock) {
  const { stock, loose } = v;
  // --- The Promenade's food court ---
  if (v.promenade) {
    const P = v.promenade;
    const groups = new Map<string, DisplaySpec[]>();
    for (const d of P.displays) {
      const key = d.draw ?? 'reach';
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    const spec = (d: DisplaySpec): SlotSpec => ({
      id: `prom-${d.id}`,
      m: new THREE.Matrix4().compose(d.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw), new THREE.Vector3().setScalar(d.scale ?? 1)),
      color: d.color,
      give: 'food' in d.give ? { loose: d.give.food, bites: d.give.bites } : { drink: d.give.drink, level: d.give.level },
      restock: d.restock,
      reach: d.reach,
      label: 'food' in d.give ? (d.diner !== undefined ? `Take their ${FOOD_LABEL[d.give.food]}` : `Take a ${FOOD_LABEL[d.give.food]}`) : d.diner !== undefined ? `Take their ${d.give.drink.toLowerCase()}` : `Take a ${d.give.drink.toLowerCase()}`,
      owner: d.diner !== undefined ? () => v.cast()?.diners[d.diner!] ?? null : undefined,
    });
    for (const [key, list] of groups) {
      if (key === 'reach') {
        stock.addShelf('prom-reach', P.root, null, list.map(spec), 0.02);
      } else if (key === 'cup') {
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
        stock.addShelf('prom-cups', P.root, { geo: sodaCupGeometry(), mat, tinted: true }, list.map(spec), 0.07);
      } else {
        const k = loose.kindOf(key);
        if (k) stock.addShelf(`prom-${key}`, P.root, { geo: k.geo, mat: k.mat }, list.map(spec), key === 'gelato' ? 0.09 : 0.04);
      }
    }
  }
  // --- Bar Lago's back bar: three shelves of bottles, each one yours to take and pour ---
  const bb = v.lounge.backBottles;
  if (bb) {
    const specs: SlotSpec[] = [];
    const m = new THREE.Matrix4(),
      c = new THREE.Color();
    for (let i = 0; i < bb.count; i++) {
      bb.getMatrixAt(i, m);
      bb.getColorAt(i, c);
      const name = bottleFor(BACK_BAR, c);
      specs.push({ id: `bb${i}`, m: m.clone(), color: c.getHex(), give: bottle(name, c.getHex()), restock: 120, reach: 0.07, label: `Take the ${name} off the shelf` });
    }
    stock.adopt('back-bar', bb, specs, 0.15);
  }
  // --- The pool bar's column of lit bottles ---
  if (v.pool?.bottles.length) {
    const k = loose.kindOf('bottle');
    if (k) {
      const specs = v.pool.bottles.map((b, i): SlotSpec => {
        const name = POOL_COLUMN[b.color] ?? 'vodka';
        return {
          id: `pool-bottle${i}`,
          m: new THREE.Matrix4().makeTranslation(b.pos.x, b.pos.y, b.pos.z),
          color: new THREE.Color(b.color).multiplyScalar(0.9).getHex(),
          give: bottle(name, b.color),
          restock: 120,
          reach: 0.07,
          label: `Take the ${name} off the column`,
        };
      });
      stock.addShelf('pool-column', v.pool.root, { geo: k.geo, mat: new THREE.MeshBasicMaterial({ color: 0xffffff }), tinted: true }, specs, 0.15);
    }
  }
}
