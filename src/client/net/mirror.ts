import * as THREE from 'three';
import { SPOTS_BY_ID, type Pocket } from '../../rules/roulette';
import type { RollResult } from '../../rules/craps';
import { anchorPx, BED, pxToLocal } from '../craps/felt';
import { FELT_Y, type CrapsTable } from '../craps/table';
import { spotAnchor, WHEEL_CENTER } from '../roulette/layout';
import { TOP, type RouletteTable } from '../roulette/table';
import type { SlotMachineView } from '../slots/machine';
import type { PiggyMachineView } from '../slots/piggy';
import type { Hud } from '../hud';
import type { Friend, Session } from './session';
import { FriendChips } from './friendChips';
import { makeChipStack } from '../chips';
import { decodeCraps, decodePiggySpin, decodeRoulette, decodeSlotSpin, encodeCraps, encodePiggySpin, encodeRoulette, resolveCraps, resolveRoulette } from './mirrorCodec';

export interface MirrorDeps {
  session: Session;
  roulette: RouletteTable;
  craps: CrapsTable;
  machines: SlotMachineView[];
  piggy: PiggyMachineView;
  hud: Hud;
  shadows: boolean;
  /** A chip clicks down at a point (friend's bets landing). */
  chip?(at: THREE.Object3D): void;
}

/** Friend colours for their chip markers (first friend teal, then pink, lime). */
const FRIEND_COLORS = [0x2fd8ff, 0xff6ad5, 0xa6ff4a];
/** How often your own layout is checked and, when changed, sent (s). */
const SEND_EVERY = 0.15;
/** After a spin, the dealer's sweep and payouts play before your friend's next bets appear (s). */
const ROULETTE_HOLD = 2.9;

interface Layer {
  roulette: FriendChips;
  craps: FriendChips;
  /** Latest layouts received, waiting for the table to finish a spin/roll. */
  rPending: Map<string, number> | null;
  cPending: Map<string, number> | null;
}

/**
 * Two-player mirroring of game actions: your friend's chips appear on your
 * roulette and craps layouts (and are swept or paid as the shared wheel and
 * dice decide), and their slot spins play on your copy of the machine they're
 * at. Uses only `session.emit` / `session.on`; nothing touches your bankroll.
 *
 * Wire events (all small):
 *  - `mr` {b: [spotIndex, amount, …]}  your roulette layout
 *  - `mc` {b: [betId, amount, …]}      your craps layout
 *  - `ms` {i, s, b, x}                 a spin on classic/video machine i
 *  - `mp` PiggySpinMsg                 a Porkbelly spin
 */
export class Mirror {
  private layers = new Map<string, Layer>();
  private sent = { r: '', c: '' };
  private pollT = 0;
  private rosterT = 0;
  private time = 0;
  private rHoldUntil = 0;
  private cHoldUntil = 0;
  private known = new Set<string>();
  private restore: (() => void)[] = [];
  /** Chips a friend is carrying off their rail in VR, shown in their hand. */
  private inHand = new Map<string, { g: THREE.Group; amount: number }>();

  constructor(private d: MirrorDeps) {
    const s = d.session;
    // The chips in your hand (VR rails at roulette and craps) ride along with your state.
    const prevExtra = s.extraState;
    s.extraState = () => {
      const h = d.roulette.rail.inHand() ?? d.craps.rail.inHand();
      return { ...(prevExtra?.() ?? {}), hc: h ? [Math.round(h.amount * 100) / 100, h.side === 'l' ? 0 : 1] : undefined };
    };
    this.restore.push(() => (s.extraState = prevExtra));
    s.on('mr', (f, data) => {
      this.layer(f).rPending = decodeRoulette(data.b);
      this.applyPending();
    });
    s.on('mc', (f, data) => {
      this.layer(f).cPending = decodeCraps(data.b);
      this.applyPending();
    });
    s.on('ms', (f, data) => {
      const m = decodeSlotSpin(data, d.machines.map((x) => x.machine));
      if (!m) return;
      // Shown unless you're mid-spin or in a bonus on that machine yourself (standing at it
      // watching your friend play is exactly when you want to see it).
      d.machines[m.i].showRemoteSpin(m.s, m.b, m.x, f.name);
    });
    s.on('mp', (f, data) => {
      const spin = decodePiggySpin(data);
      if (spin) d.piggy.showRemoteSpin(spin, f.name);
    });

    // Settle your friend's chips with the same pocket / dice as yours.
    const prevR = d.roulette.onResult;
    d.roulette.onResult = (pocket, staked, returned) => {
      prevR?.(pocket, staked, returned);
      this.rouletteResult(pocket);
    };
    const prevC = d.craps.onResult;
    d.craps.onResult = (r) => {
      prevC?.(r);
      this.crapsResult(r);
    };
    this.restore.push(() => {
      d.roulette.onResult = prevR;
      d.craps.onResult = prevC;
    });

    // Your spins go to your friend.
    d.machines.forEach((m, i) => {
      m.onSpin = (x) => s.emit('ms', { i, s: x.stops, b: x.bet, x: x.mult });
    });
    d.piggy.onSpin = (out, bonus) => s.emit('mp', encodePiggySpin(out, bonus));
    this.restore.push(() => {
      for (const m of d.machines) m.onSpin = null;
      d.piggy.onSpin = null;
    });
  }

  /** Your friend's chips as shown on your tables (for tests and debugging). */
  debug() {
    const o: Record<string, { roulette: ReturnType<FriendChips['positions']>; craps: ReturnType<FriendChips['positions']> }> = {};
    for (const [id, l] of this.layers) o[id] = { roulette: l.roulette.positions(), craps: l.craps.positions() };
    return o;
  }

  dispose() {
    for (const s of this.inHand.values()) s.g.removeFromParent();
    this.inHand.clear();
    for (const f of this.restore) f();
    this.restore = [];
    for (const l of this.layers.values()) {
      l.roulette.dispose();
      l.craps.dispose();
    }
    this.layers.clear();
  }

  update(dt: number) {
    this.time += dt;
    // Send your layouts when they change (debounced).
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = SEND_EVERY;
      const r = encodeRoulette(this.d.roulette.game.bets);
      const rs = JSON.stringify(r);
      if (rs !== this.sent.r) {
        this.sent.r = rs;
        this.d.session.emit('mr', { b: r });
      }
      const c = encodeCraps(this.d.craps.game.bets);
      const cs = JSON.stringify(c);
      if (cs !== this.sent.c) {
        this.sent.c = cs;
        this.d.session.emit('mc', { b: c });
      }
    }
    // Who's here: drop chips of friends who left, resend layouts to newcomers, track where they stand.
    this.rosterT -= dt;
    if (this.rosterT <= 0) {
      this.rosterT = 0.25;
      const friends = this.d.session.friendList();
      const ids = new Set(friends.map((f) => f.id));
      for (const [id, l] of this.layers) {
        if (ids.has(id)) continue;
        l.roulette.clear();
        l.craps.clear();
        this.layers.delete(id);
      }
      for (const f of friends) {
        if (!this.known.has(f.id)) {
          this.known.add(f.id);
          this.sent = { r: '', c: '' };
        }
        const l = this.layers.get(f.id);
        if (l && f.person) {
          const at = f.person.pos.clone().setY(f.person.pos.y + 1);
          l.roulette.owner = at;
          l.craps.owner = at;
        }
      }
      for (const id of [...this.known]) if (!ids.has(id)) this.known.delete(id);
    }
    this.applyPending();
    for (const l of this.layers.values()) {
      l.roulette.update(dt);
      l.craps.update(dt);
    }
    this.handChips();
  }

  /** Friends carrying chips from their rail: a stack in that hand. */
  private handChips() {
    const seen = new Set<string>();
    for (const f of this.d.session.friendList()) {
      const hc = f.state.hc;
      const amount = Array.isArray(hc) ? Number(hc[0]) : 0;
      const w = Array.isArray(hc) ? f.wrist(hc[1] === 0 ? 'l' : 'r') : null;
      let s = this.inHand.get(f.id);
      if (!(amount > 0 && amount < 1e6) || !w || !f.person || f.person.culled) {
        if (s) s.g.visible = false;
        continue;
      }
      seen.add(f.id);
      if (!s || s.amount !== amount) {
        s?.g.removeFromParent();
        s = { g: makeChipStack(amount), amount };
        s.g.traverse((o) => (o.raycast = () => {}));
        this.d.roulette.group.parent?.add(s.g);
        this.inHand.set(f.id, s);
      }
      s.g.visible = true;
      // Pinched between their fingers, just off the palm.
      s.g.position.copy(new THREE.Vector3(0, -0.04, -0.07).applyQuaternion(w.q).add(w.p));
    }
    for (const [id, s] of this.inHand)
      if (!seen.has(id) && !this.d.session.friendList().some((f) => f.id === id)) {
        s.g.removeFromParent();
        this.inHand.delete(id);
      }
  }

  private get rouletteIdle() {
    return this.d.roulette.game.phase === 'betting' && this.time >= this.rHoldUntil;
  }

  private get crapsIdle() {
    return this.d.craps.phase === 'betting' && this.time >= this.cHoldUntil;
  }

  /**
   * Show the latest layouts once your table is between rounds. While your
   * wheel spins or dice roll, a friend whose machine is a beat ahead may
   * already have settled: their new layout waits so the result plays here first.
   */
  private applyPending() {
    const rIdle = this.rouletteIdle,
      cIdle = this.crapsIdle;
    for (const l of this.layers.values()) {
      if (l.rPending && rIdle) {
        l.roulette.set(l.rPending);
        l.rPending = null;
      }
      if (l.cPending && cIdle) {
        l.craps.set(l.cPending);
        l.cPending = null;
      }
    }
  }

  private rouletteResult(pocket: Pocket) {
    for (const l of this.layers.values()) l.roulette.resolve(resolveRoulette(l.roulette.bets, pocket));
    this.rHoldUntil = this.time + ROULETTE_HOLD;
  }

  private crapsResult(r: RollResult) {
    for (const l of this.layers.values()) l.craps.resolve(resolveCraps(l.craps.bets, r.dice, r.pointBefore).results);
    // The table stays in 'paying' while the dealers work; a short extra beat after.
    this.cHoldUntil = this.time + 0.4;
  }

  private layer(f: Friend): Layer {
    let l = this.layers.get(f.id);
    if (l) return l;
    // Their player colour (the same as their name tag), else one by order of arrival.
    const color = f.color ?? FRIEND_COLORS[this.layers.size % FRIEND_COLORS.length];
    const { roulette, craps } = this.d;
    const rAnchor = (id: string) => {
      const spot = SPOTS_BY_ID.get(id);
      if (!spot) return null;
      const [x, z] = spotAnchor(spot);
      return new THREE.Vector3(x, TOP + 0.001, z);
    };
    const cAnchor = (id: string) => {
      const [x, z] = pxToLocal(...anchorPx(id));
      return new THREE.Vector3(x, FELT_Y + 0.001, z);
    };
    const shift = this.layers.size;
    l = {
      roulette: new FriendChips(roulette.group, rAnchor, new THREE.Vector3(WHEEL_CENTER.x + 0.3, TOP, -0.4), new THREE.Vector3(0.022 - shift * 0.044, 0, -0.02), color, this.d.shadows),
      craps: new FriendChips(craps.group, cAnchor, new THREE.Vector3(0, FELT_Y + 0.01, -BED.d / 2 + 0.1), new THREE.Vector3(0.026 - shift * 0.052, 0, -0.018), color, this.d.shadows),
      rPending: null,
      cPending: null,
    };
    if (this.d.chip) l.roulette.onPlace = l.craps.onPlace = this.d.chip;
    this.layers.set(f.id, l);
    return l;
  }
}
