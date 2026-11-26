import * as THREE from 'three';
import type { Bankroll, BankrollChange } from '../rules/bankroll';
import { auditChips, ChipLedger, type AuditResult, type ChipSnapshot } from '../rules/chipledger';
import type { Sound } from './audio';
import type { ChipRail } from './chiprail';
import { ChipPopups, ChipTray } from './chiptray';
import { FingerChips } from './fingerchip';
import { isOpenHand, isPointing, type FingerPose } from './fingers';
import type { Hands } from './hands';
import type { Interactable, Interaction, Poker } from './interaction';
import { chipValue, type LooseObjects } from './loose';
import { palms } from './palm';
import { CHIP_DENOMS, type ChipDenom } from './textures';

/**
 * Your chips, end to end (VR first, screens too): the money books
 * (ChipLedger), the wallet tray over your left palm, the chip on your
 * pointing fingertip, scooping your loose chips back with an open hand, and
 * the audit that checks it all adds up.
 *
 * Betting by touch: only a deliberate point bets. Index finger out, the other
 * fingers curled (controllers: grip squeezed, trigger untouched), pressed into
 * the felt. An open hand, a palm, a fist or a resting hand never puts a chip
 * down; an open hand on one of your loose chips scoops it back instead.
 *
 * Winnings are not left lying on the layout: the dealer pays them and pushes
 * them back to your rail (craps shows them travelling). Chips left on a
 * betting spot would ride as a bet you never meant to make, and in a shared
 * room they'd be clutter your friends could knock into play; auto-return
 * keeps the layout meaning exactly "what you chose to bet".
 */

export interface Table {
  spotAt?(world: THREE.Vector3): string | null;
  betAt(world: THREE.Vector3, amount: number): boolean;
  readonly myStaked: number;
  readonly rail: ChipRail;
}

export interface ChipSystemDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  bankroll: Bankroll;
  hands: Hands;
  interaction: Interaction;
  sound: Sound;
  inXR(): boolean;
  /** Your finger poses this frame (from the controllers' sensors or hand tracking). */
  poses(): { l: FingerPose; r: FingerPose };
  tables: { craps: Table; roulette: Table; blackjacks: (Table & { mySeat: number | null })[] };
  /** The chip you bet with (all tables) and choosing it (the tray, the watch, the rail, the HUD). */
  betChip(): ChipDenom;
  setBetChip(d: ChipDenom): void;
  /** The chip the table you're touching bets (blackjack keeps its own sizes). */
  chipFor(item: Interactable | null): ChipDenom;
  haptic(side: 'left' | 'right', strength: number, ms: number): void;
}


const SIDES = ['left', 'right'] as const;

export class ChipSystem {
  readonly ledger: ChipLedger;
  readonly tray: ChipTray;
  readonly finger: FingerChips;
  readonly popups: ChipPopups;
  loose: LooseObjects | null = null;
  /** Chosen a chip yet (this session)? Until then a pointing finger carries nothing. */
  armed = false;
  /** Times the money didn't add up (should stay empty). */
  readonly drift: { t: number; amount: number; worth: number; expected: number; note: string }[] = [];
  /** Test hooks: override the finger poses / fingertips (null: read the hands). */
  poseSource: ((side: 'left' | 'right') => FingerPose | null) | null = null;
  tipSource: ((side: 'left' | 'right') => THREE.Vector3 | null) | null = null;
  readonly stats = { felt: 0, gated: 0, collected: 0, returned: 0 };
  private expected = 0;
  private flow = 0;
  private lastStaked = 0;
  private found = 0;
  private given = 0;
  private t = 0;
  private stakedBefore = 0;
  private tapCool = new Map<string, number>();

  constructor(private d: ChipSystemDeps) {
    const rails = () => [d.tables.craps.rail, d.tables.roulette.rail, ...d.tables.blackjacks.map((b) => b.rail)];
    // Rail chips in your hands and winnings on their way are already spoken for.
    this.ledger = new ChipLedger(d.bankroll, () => rails().reduce((s, r) => s + r.held + (r.reading().away ?? 0), 0));
    this.popups = new ChipPopups(d.scene);
    this.finger = new FingerChips(d.scene);
    this.finger.onReady = (side) => d.haptic(side, 0.12, 12);
    this.tray = new ChipTray({
      scene: d.scene,
      hands: d.hands,
      sound: d.sound,
      ledger: this.ledger,
      denoms: CHIP_DENOMS,
      selected: () => d.betChip(),
      select: (den) => this.pick(den),
      palm: () => {
        const pl = palms.bySide('left');
        const h = d.hands.hands.find((x) => x.ctrl.userData.handedness === 'left');
        return pl && pl.active && !h?.held ? pl.p : null;
      },
      wrist: () => (d.inXR() ? d.hands.wrist('left') : null),
      head: () => d.camera.getWorldPosition(new THREE.Vector3()),
      placeAt: (at, amount) => this.betAt(at, amount),
      overRail: (at) => rails().some((r) => r.isOver(at)),
      dropLoose: (at, v, chips) => this.loose?.dropChips(at, v, chips, this.tag) ?? null,
      haptic: d.haptic,
      popups: this.popups,
    });
    for (const g of this.tray.grabbables) d.hands.register(g);
    // Rail chips let go of over the wallet go home too.
    for (const r of rails()) {
      r.setAbsorb((w, a) => {
        if (!this.tray.overWallet(w)) return false;
        this.tray.welcome(w, a);
        this.stats.returned++;
        return true;
      });
    }
    d.bankroll.onChange((c) => this.onBank(c));
    this.expected = this.worth();
    this.lastStaked = this.staked();

    // Felts: only a point presses them, and only with a chip to put down.
    d.interaction.feltGate = (side, item) => {
      const chip = d.chipFor(item);
      if (!this.armed || this.ledger.spendable < chip) {
        this.stats.gated++;
        this.finger.hint(side, !this.armed ? 'Pick a chip · palm up' : 'Not enough chips');
        d.haptic(side, 0.1, 10);
        d.sound.playLocal('click', 0.15, 0.7);
        return false;
      }
      this.stakedBefore = this.staked();
      return true;
    };
    d.interaction.onFeltPoke = (side) => {
      if (this.staked() > this.stakedBefore + 1e-6) {
        this.stats.felt++;
        this.finger.placed(side);
        d.haptic(side, 0.6, 40);
      }
    };
  }

  /** This client's tag for the loose chips it makes (unique across a room). */
  private tag = Math.random().toString(36).slice(2, 6);

  /** Choose the chip to bet with (and arm the fingertip). */
  pick(d: ChipDenom) {
    this.armed = true;
    this.d.setBetChip(d);
  }

  /** Your chips on every table's layout. */
  staked(): number {
    const t = this.d.tables;
    return t.craps.myStaked + t.roulette.myStaked + t.blackjacks.reduce((s, b) => s + b.myStaked, 0);
  }

  private worth(): number {
    return Math.round((this.d.bankroll.balance + this.staked() + this.ledger.out) * 100) / 100;
  }

  /** Chips set down at a point, paid from the balance: a bet on whichever table's spot it is. */
  betAt(at: THREE.Vector3, amount: number): boolean {
    const t = this.d.tables;
    return t.craps.betAt(at, amount) || t.roulette.betAt(at, amount) || t.blackjacks.some((b) => b.betAt(at, amount));
  }

  /** Is this a spot a chip would bet on (so a chip coming to rest there is worth offering)? */
  private onSpot(at: THREE.Vector3): boolean {
    const t = this.d.tables;
    return !!(t.craps.spotAt?.(at) || t.roulette.spotAt?.(at)) || t.blackjacks.some((b) => b.mySeat !== null);
  }

  /** A loose chip came to rest (it was moving because of you): on a spot, it's a bet. */
  chipRest(value: number, at: THREE.Vector3, id: string): boolean {
    if (!this.onSpot(at)) return false;
    return this.ledger.betLoose(this.ledger.loose.has(id) ? id : null, value, (a) => this.betAt(at, a));
  }

  /** A loose chip let go of from your hand: over your wallet or your rail, it goes in. */
  absorbChip(value: number, at: THREE.Vector3, id: string): boolean {
    const rails = [this.d.tables.craps.rail, this.d.tables.roulette.rail, ...this.d.tables.blackjacks.map((b) => b.rail)];
    if (!this.tray.overWallet(at) && !rails.some((r) => r.isOver(at))) return false;
    if (this.ledger.loose.has(id)) this.ledger.collect(id);
    else this.ledger.pocketFound(value);
    this.tray.welcome(at, value);
    this.stats.returned++;
    return true;
  }

  /** Click / tap on one of your loose chips (screens): back into the wallet. */
  tapChip(id: string): boolean {
    const it = this.loose?.items.get(id);
    if (!it || !this.ledger.loose.has(id)) return false;
    const at = it.body.pos.clone();
    if (!this.loose!.removeChip(id)) return false;
    const v = this.ledger.collect(id);
    this.tray.welcome(at, v);
    this.stats.collected++;
    return true;
  }

  /** One of your loose chips left on a friend's side. */
  chipGone(id: string) {
    this.ledger.lose(id);
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  /** The fingertips for interaction.pokers: where they are, straight, pointing. */
  pokers(): Poker[] {
    if (!this.d.inXR() && !this.tipSource) return [];
    const out: Poker[] = [];
    for (const side of SIDES) {
      const tip = this.tipOf(side);
      const pose = this.poseOf(side);
      if (!tip || !pose) continue;
      const h = this.d.hands.hands.find((x) => x.ctrl.userData.handedness === side);
      out.push({ id: side, tip, extended: pose[1] < 0.45, pointing: isPointing(pose) && !h?.held });
    }
    return out;
  }

  private tipOf(side: 'left' | 'right') {
    return this.tipSource ? this.tipSource(side) : this.d.hands.fingertip(side);
  }

  private poseOf(side: 'left' | 'right'): FingerPose | null {
    if (this.poseSource) return this.poseSource(side);
    const p = this.d.poses();
    return side === 'left' ? p.l : p.r;
  }

  update(dt: number) {
    this.t += dt;
    const xr = this.d.inXR() || !!this.tipSource;
    const tips = SIDES.map((side) => {
      const tip = xr ? this.tipOf(side) : null;
      const pose = xr ? this.poseOf(side) : null;
      return { side, tip, pose, pointing: !!pose && isPointing(pose) };
    });
    this.tray.update(dt, tips);
    if (!xr) this.tray.returnAll();
    // The chip on your fingertip.
    this.finger.update(
      dt,
      tips.map((f) => {
        const hover = this.d.interaction.fingerHover(f.side);
        const chip = this.d.chipFor(hover?.item ?? null);
        return {
          side: f.side,
          tip: f.tip,
          // Not while it's reaching into the tray (pointing there picks a chip).
          pointing: f.pointing && !(this.tray.open && !!f.tip && f.tip.distanceTo(this.tray.group.position) < 0.16),
          near: !!f.tip && this.d.interaction.nearFelt(f.tip),
          denom: this.armed && this.ledger.spendable >= chip ? chip : null,
          hover,
        };
      }),
    );
    if (xr) this.scoop(tips);
    this.popups.update(dt);
    this.watch();
  }

  /**
   * An open hand (not pointing) touching your loose chips scoops them back
   * into the wallet: a tap on one, or a sweep across a few.
   */
  private scoop(tips: { side: 'left' | 'right'; tip: THREE.Vector3 | null; pose: FingerPose | null; pointing: boolean }[]) {
    const loose = this.loose;
    if (!loose || this.ledger.loose.size === 0) return;
    for (const f of tips) {
      if (!f.pose || !isOpenHand(f.pose) || f.pointing) continue;
      if ((this.tapCool.get(f.side) ?? 0) > this.t) continue;
      const h = this.d.hands.hands.find((x) => x.ctrl.userData.handedness === f.side);
      if (h?.held) continue;
      const pi = palms.sides.indexOf(f.side);
      const pl = pi >= 0 && palms.seen[pi] ? palms.platforms[pi] : null;
      const near = [...(pl ? loose.chipsNear(pl.p, 0.035) : []), ...(f.tip ? loose.chipsNear(f.tip, 0.025) : [])];
      let got = 0;
      const at = new THREE.Vector3();
      for (const it of new Set(near)) {
        if (!this.ledger.loose.has(it.id)) continue;
        at.copy(it.body.pos);
        if (!loose.removeChip(it.id)) continue;
        got += this.ledger.collect(it.id);
        this.stats.collected++;
      }
      if (got > 0) {
        this.tray.welcome(at, got, f.side);
        this.tapCool.set(f.side, this.t + 0.08);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  /** Everything the audit looks at, right now. */
  snapshot(): ChipSnapshot {
    const t = this.d.tables;
    const rails = [t.craps.rail, t.roulette.rail, ...t.blackjacks.map((b) => b.rail)];
    const at = rails.find((r) => r.group.visible);
    if (at) at.wallet.sync(at.onRail);
    return {
      balance: this.d.bankroll.balance,
      bets: { craps: t.craps.myStaked, roulette: t.roulette.myStaked, blackjack: t.blackjacks.reduce((s, b) => s + b.myStaked, 0) },
      hand: this.ledger.inHand,
      loose: this.ledger.onTable,
      physicalHand: this.tray.carried,
      physicalLoose: this.loose ? this.loose.valueOf(this.ledger.loose.keys()) : this.ledger.onTable,
      rail: at ? at.reading() : null,
    };
  }

  /** The one check: the parts agree, and nothing appeared or vanished between frames. */
  audit(): AuditResult & { drift: ChipSystem['drift'] } {
    const r = auditChips(this.snapshot());
    for (const d of this.drift) r.issues.push(`${d.note}: ${d.amount > 0 ? '+' : ''}${d.amount} (worth ${d.worth}, expected ${d.expected})`);
    return { ...r, ok: r.issues.length === 0, drift: this.drift };
  }

  /** Every bankroll change except chips moving between your wallet and your hands / the table top. */
  private onBank(c: BankrollChange) {
    if (c.reason !== 'chips') this.flow += c.delta;
  }

  /**
   * Frame by frame: worth may only change by what the bankroll was paid or
   * charged (a win, a slot spin, a drink, a bonus), chips found or given
   * away, and bets moving on or off the layouts. Anything else is a leak or a
   * double count: noted in `drift` (and the books carry on from the real
   * figure). A stake going onto a layout is a charge that worth keeps (staked
   * rose); a bet that lost, or a stake dealt into a hand, is worth that left
   * the layout with nothing paid (staked fell).
   */
  private watch() {
    const worth = this.worth();
    const staked = this.staked();
    const foundD = this.ledger.found - this.found;
    const givenD = this.ledger.given - this.given;
    this.found = this.ledger.found;
    this.given = this.ledger.given;
    const expected = this.expected + this.flow + foundD - givenD;
    this.flow = 0;
    const off = Math.round((worth - expected) * 100) / 100;
    const rise = Math.max(0, staked - this.lastStaked),
      fell = Math.max(0, this.lastStaked - staked);
    const explained = Math.abs(off) <= 0.005 || (off > 0 && off <= rise + 0.005) || (off < 0 && -off <= fell + 0.005);
    if (!explained) {
      this.drift.push({ t: Math.round(this.t * 100) / 100, amount: off, worth, expected: Math.round(expected * 100) / 100, note: off > 0 ? 'money from nowhere' : 'money lost' });
      if (this.drift.length > 50) this.drift.shift();
      console.warn('[chips] worth drifted', this.drift.at(-1));
    }
    this.expected = worth;
    this.lastStaked = staked;
  }
}

export { chipValue };
