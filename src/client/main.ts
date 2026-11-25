import * as THREE from 'three';
import { Bankroll, type BankrollState } from '../rules/bankroll';
import { DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY } from '../rules/machines';
import { pocketColor, pocketLabel } from '../rules/roulette';
import { CryptoRng } from '../rules/rng';
import { Sound } from './audio';
import { buildCasino, POSITIONS, registerHall, SLOTS_YAW } from './casino';
import { preloadChips } from './chips';
import { CrapsTable } from './craps/table';
import { PostFX } from './post';
import { Dialogue, voiceArbiter } from './dialogue';
import { AREA_NODES, buildAreas, registerAreas } from './areas';
import { Session } from './net/session';
import { Mirror } from './net/mirror';
import { setupLobby } from './net/lobby';
import { connect, newCode, type Transport } from './net/transport';
import { VrMenu } from './vrmenu';
import { SelfBody } from './selfbody';
import { SwimFX } from './areas/swim';
import { OPEN, type FingerPose } from './fingers';
import { FINGER, THUMB, curlFingers, setFingers } from './net/embody';
import { bakeStatic } from './merge';
import { buildBlackjack } from './pit';
import { SlotRows } from './decor';
import { money, type GameContext } from './game';
import { Hands } from './hands';
import { Hud, type NavItem } from './hud';
import { Interaction } from './interaction';
import { Lounge } from './lounge';
import { Crowd, POSE, randomLook, staffLook, type Person } from './people';
import { Player, type Viewpoint } from './player';
import { detectTier } from './quality';
import { WHEEL_CENTER } from './roulette/layout';
import { RouletteTable } from './roulette/table';
import { SlotMachineView } from './slots/machine';
import { PiggyMachineView } from './slots/piggy';
import { World } from './world';
import { assets } from './assets';
import { Crew } from './crew';
import { Night } from './night';
import { TouchControls } from './touch';
import type { Control } from './hud';
import { CHIP_COLORS, CHIP_DENOMS, chipLabel } from './textures';
import { CROUPIER_LINES, STAFF, TIPSY_LINES, rouletteCall } from './speech';
import { mouthOf, voices } from './voices';
import { Throwables } from './throwables';
import { DrinkSync } from './net/drinksync';
import { BUMP_LINES, Bodies, friendShove } from './bodies';

const SAVE_KEY = 'palazzo-lago.bankroll.v1';

function loadBankroll(): Bankroll {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return new Bankroll(JSON.parse(raw) as BankrollState);
  } catch {
    /* private mode or corrupt save: start fresh */
  }
  return new Bankroll();
}

function saveBankroll(b: Bankroll) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(b.snapshot()));
  } catch {
    /* ignore */
  }
}

async function main() {
  const quality = detectTier();
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFramebufferScaleFactor(quality.xrFramebufferScale);
  renderer.xr.setFoveation(1);
  // We update the XR camera ourselves at the top of each frame, so everything
  // that follows the head (vignette, held drinks, toasts) uses this frame's pose.
  renderer.xr.cameraAutoUpdate = false;
  document.getElementById('app')!.appendChild(renderer.domElement);

  // Photo textures, the HDRI and the people (all CC0). Falls back to procedural art if anything fails.
  const loadingSub = document.querySelector('#loading .sub');
  await assets.load(renderer, (k) => {
    if (loadingSub) loadingSub.textContent = `Opening the doors… ${Math.round(k * 100)}%`;
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.03, 400);
  const world = new World();
  const player = new Player(camera, renderer, world);
  scene.add(player.rig);
  const interaction = new Interaction(renderer.domElement, camera, renderer, player.rig);
  player.attach(interaction);
  const hands = new Hands(renderer, player.rig, scene);
  hands.onHaptic = (hand, s, ms) => interaction.pulse(hand.ctrl, s, ms);

  const casino = buildCasino(scene, renderer, quality);
  registerHall(world, casino);
  registerAreas(world);
  const sound = new Sound(scene, camera);
  const bankroll = loadBankroll();
  let saveTimer = 0;
  bankroll.onChange(() => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveBankroll(bankroll), 400);
  });
  const hud = new Hud(bankroll, scene, renderer, interaction);
  voices.init(sound, hud, scene);
  preloadChips();

  const ctx: GameContext = { scene, interaction, sound, bankroll, hud, rng: new CryptoRng(), quality };
  const crowd = new Crowd(scene, quality, world, assets.people);
  // Beyond the casino floor: hotel corridor, elevator lobby, pool deck, Suite 3201.
  const areas = buildAreas({ scene, quality, interaction, sound, player, world, toast: (t) => hud.toast(t, 'info') });

  // --- Games -------------------------------------------------------------------
  const roulette = new RouletteTable(ctx, POSITIONS.roulette);
  world.addLocalBox(roulette.group, -0.28, -0.02, 2.95, 1.15);
  world.addLocalBox(roulette.group, WHEEL_CENTER.x - 0.62, -0.25, 0.3, 0.3);
  for (const x of [-0.75, 0.95]) world.addLocalBox(roulette.group, x, 0.98, 0.36, 0.36);
  const themes = [
    { body: 0x7a0c14, accent: 0xff3a3a, screenBg: ['#2a0608', '#0c0203'] as [string, string], reelBg: ['#fffaf0', '#c9bfa8'] as [string, string] },
    { body: 0x0f2a5a, accent: 0x4ab0ff, screenBg: ['#0d2a52', '#050c1c'] as [string, string], reelBg: ['#13305e', '#0a1630'] as [string, string] },
    { body: 0x0c3d2a, accent: 0x5aff9a, screenBg: ['#0c3a26', '#03120a'] as [string, string], reelBg: ['#12442c', '#08200f'] as [string, string] },
  ];
  const machines = [DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY].map((m, i) => {
    const off = (i - 1) * 0.95;
    const yaw = SLOTS_YAW - off * 0.22;
    const right = new THREE.Vector3(Math.cos(SLOTS_YAW), 0, -Math.sin(SLOTS_YAW));
    const fwd = new THREE.Vector3(Math.sin(SLOTS_YAW), 0, Math.cos(SLOTS_YAW));
    const pos = POSITIONS.slots.clone().addScaledVector(right, off).addScaledVector(fwd, -Math.abs(off) * 0.12);
    const view = new SlotMachineView(ctx, m, pos, yaw, themes[i]);
    world.addLocalBox(view.group, 0, -0.05, 0.74, 0.64);
    world.addLocalBox(view.group, 0, 0.78, 0.34, 0.34);
    return view;
  });
  // Porkbelly Payday: a premium cabinet at the end of the slot bank.
  const piggy = (() => {
    const off = 1.95;
    const right = new THREE.Vector3(Math.cos(SLOTS_YAW), 0, -Math.sin(SLOTS_YAW));
    const fwd = new THREE.Vector3(Math.sin(SLOTS_YAW), 0, Math.cos(SLOTS_YAW));
    const pos = POSITIONS.slots.clone().addScaledVector(right, off).addScaledVector(fwd, -off * 0.12);
    const view = new PiggyMachineView(ctx, pos, SLOTS_YAW - off * 0.22);
    world.addLocalBox(view.group, 0, -0.05, 0.84, 0.66);
    world.addLocalBox(view.group, 0, 0.82, 0.34, 0.34);
    return view;
  })();
  const craps = new CrapsTable(ctx, POSITIONS.craps);
  world.addLocalBox(craps.group, 0, 0, 3.75, 1.7);

  // --- Places and people -------------------------------------------------------------
  // Throwing physics (glasses fly, land, break); your own body and hands are never a landing spot.
  const throwables = new Throwables({
    scene,
    world,
    sound,
    camera,
    isSelf: (o) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.noLand) return true;
      return false;
    },
  });
  const lounge = new Lounge({ ...ctx, crowd, hands, player, world, throwables });
  const slotRows = new SlotRows(ctx, crowd, world);

  // Walking routes through the open floor; edges are found automatically.
  crowd.setGraph([
    ...AREA_NODES,
    [0, 12], [-4.5, 11.8], [4.5, 11.8], [0, 8.6], [-3.6, 7.6], [3.6, 7.6],
    [6.6, 2], [4.8, -2.8], [0, -4.6], [-4.8, -2.8], [-6.6, 2], [-4.4, 7.0], [4.4, 7.0],
    [-11, -2.5], [-11.2, 4.5], [-4.5, -10.5], [-10.5, -11], [3.8, -11.2], [0, -12.4],
    [9.2, -6.5], [9.4, -11.5], [9.4, -1.8], [14.6, -11.5], [14.6, -6], [14.6, -1.2],
    [10.5, 10.5], [14.5, 10], [12.5, 1.2], [-10.1, 9.8], [-13.2, 8.6], [-9, 12.4],
    [0, -15.6], [-5.5, -16], [5.5, -16], [-8.5, -15.2], [8.5, -15.2],
  ]);

  // Croupier and the regulars around the roulette table.
  const spots = roulette.spots();
  const croupier = crowd.add('croupier', staffLook('dealer'), spots.croupier.pos, spots.croupier.yaw);
  const light = quality.name === 'quest2' || quality.name === 'mobile';
  for (const w of light ? spots.watchers.slice(0, 2) : spots.watchers) {
    const p = crowd.add(w.seated ? 'patron' : 'watch', randomLook(), w.pos, w.yaw);
    if (p && w.seated) p.seatY = 0.68;
  }
  const near = (p: THREE.Vector3, r: number) => player.feet().distanceTo(p) < r;

  // Craps crew: boxman and two base dealers across the table, the stickman on
  // the players' side, and a few regulars at the rail.
  const cs = craps.spots();
  const stickman = crowd.add('croupier', staffLook('dealer'), cs.stickman.pos, cs.stickman.yaw);
  const crapsDealers = [cs.boxman, ...cs.dealers].map((d) => crowd.add('croupier', staffLook('dealer'), d.pos, d.yaw));
  for (const w of light ? cs.players.slice(0, 3) : cs.players) crowd.add('watch', randomLook(), w.pos, w.yaw);
  // Blackjack tables in the pit, each with a dealer and a few players.
  for (const spec of [
    { x: -11.1, z: -4.4, yaw: 0, felt: '#1d5a3a', min: 25, max: 5000 },
    { x: -3.95, z: -4.4, yaw: 0, felt: '#123f6a', min: 100, max: 10000 },
  ]) {
    const t = buildBlackjack(quality, spec);
    scene.add(t.group);
    bakeStatic(t.group, { shadows: quality.shadows });
    world.addLocalBox(t.group, 0, 0.35, 2.3, 1.3);
    crowd.add('croupier', staffLook('dealer'), t.dealer.pos, t.dealer.yaw);
    for (const k of quality.name === 'quest2' || quality.name === 'mobile' ? [1, 4] : [0, 2, 3, 5]) {
      const st = t.seats[k];
      const p = crowd.add('patron', randomLook(), st.pos, st.yaw);
      if (p) p.seatY = 0.72;
    }
  }
  let crapsBetsTimer = 0;
  const stickSays = (text: string) => {
    const dur = voices.talk({ who: 'Stickman', text, voice: STAFF.stickman, at: stickman ? mouthOf(stickman) : null, priority: true, group: 'stickman', fallback: { pitch: 1.05, rate: 1.05, voice: 1 } });
    if (stickman) crowd.speak(stickman, dur);
  };
  craps.onRoll = () => {
    if (stickman) {
      stickman.actionKind = 'reach';
      stickman.action = 1.0;
    }
    if (near(craps.group.position, 4)) crew.react('spin', { chance: 0.5 });
  };
  craps.onResult = (r) => {
    if (near(craps.group.position, 7)) stickSays(r.call);
    for (const d of crapsDealers) {
      if (d && r.results.length) {
        d.actionKind = 'reach';
        d.action = 1.6;
      }
    }
    const staked = r.results.filter((x) => x.outcome !== 'move').reduce((s, x) => s + (x.outcome === 'lose' || !x.staysUp ? x.stake : 0), 0);
    const returned = r.results.reduce((s, x) => s + x.returned, 0);
    night.result('craps', staked, returned, craps.group.position);
    if (r.pointMade || (r.comeOut && (r.total === 7 || r.total === 11))) {
      crowd.react(craps.group.position, 4, 'cheer');
      sound.play('cheer', craps.group, { volume: r.pointMade ? 0.9 : 0.5 });
    } else if (r.sevenOut) {
      crowd.react(craps.group.position, 4, 'gasp');
      sound.play('gasp', craps.group, { volume: 0.6 });
    }
    crapsBetsTimer = r.sevenOut ? 5.5 : 0;
  };
  let placeBetsTimer = 0;
  roulette.onSpin = () => {
    if (croupier) {
      croupier.actionKind = 'reach';
      croupier.action = 1.2;
    }
    if (near(roulette.group.position, 5)) croupierSays(CROUPIER_LINES.noMore);
    if (near(roulette.group.position, 4)) crew.react('spin', { chance: 0.35 });
  };
  roulette.onResult = (pocket, staked, returned) => {
    const call = rouletteCall(pocketLabel(pocket), pocketColor(pocket));
    if (near(roulette.group.position, 6)) croupierSays(call);
    night.result('roulette', staked, returned, roulette.group.position);
    if (returned >= staked * 3 && returned > 0) {
      crowd.react(roulette.group.position, 3.5, 'cheer');
      sound.play('cheer', roulette.group, { volume: 0.8 });
    } else if (returned === 0 && staked >= 100) {
      crowd.react(roulette.group.position, 3.5, 'gasp');
      sound.play('gasp', roulette.group, { volume: 0.6 });
    }
    placeBetsTimer = 4.5;
  };

  // Waiters with trays of champagne.
  const waiters: Person[] = [];
  let lastOffer = -60;
  for (let i = 0; i < 2; i++) {
    const w = crowd.add('waiter', staffLook('waiter'), crowd.randomNode());
    if (!w) continue;
    waiters.push(w);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    w.proxy = proxy;
    scene.add(proxy);
    interaction.register({
      object: proxy,
      label: 'Take a glass of champagne',
      onSelect: () => {
        lounge.offerChampagne();
        w.pause = 1.5;
        lastOffer = performance.now() / 1000;
      },
    });
  }
  // Your crew for the night, and the shape of the night.
  const crew = new Crew(crowd, world, player, hud, sound, randomLook);
  // People are solid: you squeeze past them, and push them if you keep going.
  let pushFriend: ((dx: number, dz: number) => void) | null = null;
  const bodies = new Bodies({
    crowd,
    world,
    player,
    hands,
    onBump: (p, k) => {
      // One of the boys says something (recorded lines only); anyone else just catches their breath.
      const b = crew.buddies.find((x) => x.person === p);
      if (b && k > 0.5 && !voiceArbiter.busy() && !voices.priorityBusy) {
        const lines = BUMP_LINES.filter((l) => voices.has(b.voiceId, l));
        if (lines.length) {
          crew.say(b, lines[Math.floor(Math.random() * lines.length)]);
          return;
        }
      }
      if (k > 0.3) sound.play('gasp', p.pos, { volume: 0.1 + 0.3 * k, rate: 1.2 + Math.random() * 0.25 });
    },
    onPushFriend: (_p, dx, dz) => pushFriend?.(dx, dz),
  });
  const night = new Night(scene, hud, sound, crew, crowd, bankroll);
  // Guests talk among themselves, and to you when you stop and look at them.
  const startChips = bankroll.balance;
  const dialogue = new Dialogue({
    scene,
    camera,
    crowd,
    sound,
    hud,
    interaction,
    feet: () => player.feet(),
    inXR: () => player.inXR,
    ctx: () => ({ chips: bankroll.balance, up: bankroll.balance - startChips, drink: lounge.holdingDrink, name: me.name }),
  });
  // Shout big wins to your friend in a two-player game.
  const nightResult = night.result.bind(night);
  night.result = (game, staked, returned, at) => {
    nightResult(game, staked, returned, at);
    if (returned > 0 && returned >= Math.max(staked * 5, 100)) setTimeout(() => dialogue.overheard(at), 1800);
    if (session && returned > 0 && returned >= Math.max(staked * 10, 250)) session.bigWin(game === 'slots' ? 'the slots' : game, returned);
  };
  const croupierSays = (text: string) => {
    const dur = voices.talk({ who: 'Croupier', text, voice: STAFF.croupier, at: croupier ? mouthOf(croupier) : null, priority: true, group: 'croupier', fallback: { pitch: 0.9, rate: 0.95, voice: 0 } });
    if (croupier) crowd.speak(croupier, dur);
    voiceArbiter.claim(dur);
  };
  machines.forEach((m) => {
    m.onResult = (staked, won, feature) => {
      night.result('slots', staked, won, m.group.position);
      if (feature) {
        night.complete('bonus');
        crew.react('bonus', { force: true, cheer: true });
      }
    };
    m.onPick = (_won, done, total) => {
      if (done) night.result('slots', 0, total, m.group.position);
    };
  });
  piggy.onResult = (staked, won, feature) => {
    night.result('slots', staked, won, piggy.group.position);
    if (feature) {
      night.complete('bonus');
      crew.react('bonus', { force: true, cheer: true });
    }
  };
  piggy.onBonusEnd = (won, features) => {
    night.result('slots', 0, won, piggy.group.position);
    if (features.length > 1 || won >= piggy.bonusBet * 50) {
      crowd.react(piggy.group.position, 4, 'cheer');
      sound.play('cheer', piggy.group, { volume: 0.8 });
    }
  };
  lounge.onOrder = () => crew.react('order', { chance: 0.7 });
  // A few drinks in, the crew notices.
  lounge.onTipsy = (stage) => {
    const line = TIPSY_LINES[stage];
    if (line && !voiceArbiter.busy() && !voices.priorityBusy) crew.sayNear(line);
  };
  lounge.onTip = () => {
    night.complete('tip');
    crew.react('tip', { force: true });
  };
  lounge.onRound = () => {
    night.complete('round');
    crew.react('round', { force: true });
  };
  setTimeout(() => crew.react('arrive', { force: true }), 2500);

  // A living floor: friends chatting in circles (drinks in hand), people snapping
  // photos of the glass ceiling and the fountains, and pairs strolling together.
  // Groups are added most-visible first, so smaller tiers keep the best ones.
  const groups: [number, number, number, number][] = [
    [-2.7, 9.7, 3, 0.7], // lobby, by the entrance
    [-12.6, 10.6, 3, 1], // Bar Lago regulars
    [3.1, 10.4, 2, 0.5],
    [6.9, 0.4, 2, 0.5], // by the slots
    [-5.4, -16.0, 3, 0.8], // terrace
    [-3.9, 1.4, 2, 0.6], // edge of the pit
    [5.8, -15.8, 2, 0.8],
    [9.9, 9.3, 3, 0.6],
    [-11.4, 4.6, 2, 0.7],
    [4.2, -6.2, 3, 0.5],
  ];
  for (const [x, z, n, drinks] of groups) {
    if (crowd.capacity - crowd.people.length < n + 7) break;
    crowd.addGroup(x, z, n, { drinks });
  }
  const glass = new THREE.Vector3(0, 7, 2);
  crowd.addPhotographer(new THREE.Vector3(1.3, 0, 3.4), glass);
  crowd.addPhotographer(new THREE.Vector3(-0.4, 0, -14.8), new THREE.Vector3(0, 0, -40));
  if (crowd.capacity - crowd.people.length > 10) crowd.addPhotographer(new THREE.Vector3(-1.6, 0, 1.2), glass);
  const pairs = Math.max(1, Math.min(3, Math.floor((crowd.capacity - crowd.people.length - 3) / 4)));
  for (let i = 0; i < pairs; i++) crowd.addPair(crowd.randomNode());

  // Guests wandering the floor fill the rest of the crowd.
  areas.populate(crowd);
  const wanderers = crowd.capacity - crowd.people.length - 1;
  for (let i = 0; i < wanderers; i++) crowd.add('wander', randomLook(), crowd.randomNode());

  // VR hands: chips from the rack, the slot lever.
  for (const g of roulette.grabbables) hands.register(g);
  for (const g of craps.grabbables) hands.register(g);
  const lever = machines[0].leverGrab();
  if (lever) hands.register(lever);

  // Teleport / walk by selecting the floor.
  interaction.register({ object: roulette.group, kind: 'surface' });
  interaction.register({ object: craps.group, kind: 'surface' });
  for (const m of machines) interaction.register({ object: m.group, kind: 'surface' });
  interaction.register({ object: piggy.group, kind: 'surface' });
  interaction.register({ object: casino.floor, kind: 'floor', onSelect: (e) => player.teleportTo(e.hit.point) });

  // --- Navigation -------------------------------------------------------------
  const lobby: Viewpoint = { id: 'lobby', label: 'Lobby', position: POSITIONS.start.clone(), yaw: -0.08, pitch: -0.04, eye: 1.65 };
  const terrace: Viewpoint = { id: 'terrace', label: 'Terrace', position: new THREE.Vector3(0, 0, -16.2), yaw: 0, pitch: 0.02, eye: 1.65 };
  const bar: Viewpoint = { id: 'bar', label: 'Bar Lago', position: new THREE.Vector3(-13.6, 0, 9.3), yaw: Math.PI / 2, pitch: -0.12, eye: 1.65 };
  const slotsOverview: Viewpoint = {
    id: 'slots',
    label: 'Slots',
    position: POSITIONS.slots.clone().add(new THREE.Vector3(Math.sin(SLOTS_YAW), 0, Math.cos(SLOTS_YAW)).multiplyScalar(2.6)),
    yaw: SLOTS_YAW,
    pitch: -0.08,
    eye: 1.65,
  };
  const nav: NavItem[] = [
    { id: 'lobby', label: 'Lobby', viewpoint: lobby },
    { id: 'roulette', label: 'Roulette', viewpoint: roulette.viewpoint },
    { id: 'slots', label: 'Slots', viewpoint: slotsOverview },
    ...machines.map((m) => ({ id: m.machine.id, label: m.machine.name, viewpoint: m.viewpoint })),
    { id: piggy.machine.id, label: piggy.machine.name, viewpoint: piggy.viewpoint },
    { id: 'bar', label: 'Bar Lago', viewpoint: bar },
    { id: 'terrace', label: 'Terrace', viewpoint: terrace },
    { id: 'craps', label: 'Craps', viewpoint: craps.viewpoint },
    ...areas.nav,
  ];
  hud.setNav(nav);
  // Tables count as 'at the game' anywhere around them (walk up and play); machines when you stand at one.
  const seatable: { vp: Viewpoint; label: string; center?: THREE.Vector3; reach?: number }[] = [{ vp: roulette.viewpoint, label: 'Sit at roulette', center: roulette.group.position.clone().add(new THREE.Vector3(0.2, 0, 0.1)), reach: 2.6 }, { vp: craps.viewpoint, label: 'Shoot dice', center: craps.group.position.clone(), reach: 2.9 }, ...machines.map((m) => ({ vp: m.viewpoint, label: `Play ${m.machine.name}` })), { vp: piggy.viewpoint, label: `Play ${piggy.machine.name}` }, ...lounge.seats.map((vp) => ({ vp, label: 'Sit at the bar' }))];
  hud.onNavigate = (item) => {
    if (!item.viewpoint) return;
    const seat = seatable.find((s) => s.vp === item.viewpoint);
    if (seat && !player.inXR) player.sit(seat.vp);
    else {
      if (player.seated) player.stand();
      // Far places (the suite, up the tower) are a cut, not a glide through walls.
      if (item.viewpoint.position.distanceTo(player.feet()) > 40) player.place(item.viewpoint);
      else player.travel(item.viewpoint);
    }
  };
  player.place(lobby);
  player.current = null;

  /** The game you are at: the one you are sitting at, or one you are standing close to. */
  const nearestSeat = (r: number) => {
    const f = player.feet();
    let best: (typeof seatable)[number] | null = null,
      bd = 1;
    for (const s of seatable) {
      // Distance as a fraction of how close you need to be (tables are big).
      const d = (s.center ? s.center.distanceTo(f) : s.vp.position.distanceTo(f)) / (s.reach ?? r);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  // --- Keyboard, entry screen, map --------------------------------------------------
  const enter = document.getElementById('enter')!;
  // A headset browser (Quest) can run immersive VR: there we never grab the mouse
  // pointer, which would swallow every click (including Enter VR).
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  const vrCapable = !!xr && (await xr.isSessionSupported('immersive-vr').catch(() => false));
  // Embedded in another page (the claude.ai viewer frames it): browsers block VR and the
  // microphone there unless the frame allows them. Offer to open the game on its own page.
  const framed = (() => {
    try {
      return window.top !== window.self;
    } catch {
      return true;
    }
  })();
  if (framed) {
    const note = document.getElementById('frame-note')!;
    const ua = navigator.userAgent;
    const headset = /OculusBrowser|Quest|Pico|Vive/i.test(ua) || !!xr;
    if (headset && !vrCapable) note.hidden = false;
    document.getElementById('frame-open')!.addEventListener('click', () => {
      const w = window.open(location.href, '_blank', 'noopener');
      if (!w) hud.toast('Your browser blocked the new tab — open this page from its own link instead', 'warn');
    });
  }
  const lock = () => {
    if (!vrCapable) player.lockPointer();
  };
  const touch = new TouchControls(player);
  const isTouch = touch.enabled;
  // Once faded, remove the entry screen entirely so it can never catch a tap.
  new MutationObserver(() => {
    if (enter.classList.contains('done')) setTimeout(() => enter.classList.add('gone'), 450);
  }).observe(enter, { attributes: true, attributeFilter: ['class'] });
  // Typing in a text box (name, room code, chat) must not walk, sit or bet.
  addEventListener(
    'keydown',
    (e) => {
      if (e.target instanceof HTMLInputElement) e.stopImmediatePropagation();
    },
    true,
  );
  // --- Start screen: solo, host a two-player room, or join one --------------------------
  let session: Session | null = null;
  /** Your friend's chips and slot spins shown on your screen (two-player rooms). */
  let mirror: Mirror | null = null;
  const roomPill = document.getElementById('room-pill') as HTMLButtonElement;
  const chatForm = document.getElementById('chat') as HTMLFormElement;
  const chatInput = document.getElementById('chat-input') as HTMLInputElement;
  const voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
  const showVoice = () => {
    const v = session?.voice;
    voiceBtn.hidden = !session;
    if (!v) return;
    voiceBtn.textContent = !v.enabled ? 'Voice off' : v.muted ? 'Muted (V)' : v.connectedCount ? 'Voice live (V)' : 'Voice on…';
    voiceBtn.classList.toggle('live', v.enabled && !v.muted);
  };
  const toggleVoice = async () => {
    const s = session;
    if (!s) return;
    if (!s.voice.enabled) {
      voiceBtn.textContent = 'Allow the mic…';
      const err = await s.enableVoice();
      if (err) hud.toast(err, 'warn');
      else hud.toast('Voice chat on · V to mute', 'win');
    } else s.voice.setMuted(!s.voice.muted);
    showVoice();
  };
  voiceBtn.addEventListener('click', () => void toggleVoice());
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && session?.voice.enabled && !player.inXR) session.voice.setMuted(!session.voice.muted);
  });
  const showRoom = (friends: string[]) => {
    if (!session) return;
    roomPill.hidden = false;
    showVoice();
    roomPill.textContent = `Room LAGO-${session.code} · ${friends.length ? 'with ' + friends.join(', ') : 'waiting for your friend'} · Chat`;
  };
  const openChat = () => {
    if (!session) return;
    chatForm.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    chatInput.focus();
  };
  const closeChat = () => {
    chatForm.hidden = true;
    chatInput.blur();
  };
  roomPill.addEventListener('click', () => (chatForm.hidden ? openChat() : closeChat()));
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    session?.say(chatInput.value);
    chatInput.value = '';
    closeChat();
  });
  for (const b of chatForm.querySelectorAll('.quick button')) {
    b.addEventListener('click', () => {
      const k = (b as HTMLElement).dataset.gesture;
      if (k) session?.offer(k as 'highfive' | 'fistbump' | 'handshake' | 'wave');
      else session?.say(b.textContent ?? '');
      closeChat();
    });
  }
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChat();
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && session && chatForm.hidden && !player.inXR) {
      e.preventDefault();
      openChat();
    }
  });
  let drinkSync: DrinkSync | null = null;
  const buzz = (side: 'left' | 'right', strength: number, ms: number) => {
    for (const { handedness, gamepad } of interaction.gamepads()) {
      if (handedness !== side) continue;
      const g = gamepad as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[]; vibrationActuator?: { playEffect(t: string, o: object): void } };
      g.hapticActuators?.[0]?.pulse(strength, ms);
    }
  };
  const startSession = (net: { transport: Transport; host: boolean }, name: string, avatar: number) => {
    mirror?.dispose();
    mirror = null;
    session?.leave();
    session = new Session({
      transport: net.transport,
      host: net.host,
      name,
      avatar,
      crowd,
      player,
      hud,
      scene,
      bankroll,
      roulette,
      craps,
      listener: sound.listener,
      hands: () => (player.inXR ? { l: hands.wrist('left'), r: hands.wrist('right') } : null),
      wrists: () => (player.inXR ? { l: hands.wristPose('left'), r: hands.wristPose('right') } : null),
      grip: () => gripValues(),
      fingers: () => fingerPoses(),
      knock: (at) => {
        sound.play('chips', at, { volume: 0.6, rate: 0.5 });
        sound.play('ballDrop', at, { volume: 0.9, rate: 0.35 });
      },
      pat: (at) => sound.play('chip', at, { volume: 0.6, rate: 0.45 }),
      haptic: buzz,
      slap: (at) => {
        sound.play('ballDrop', at, { volume: 1, rate: 0.45 });
        sound.play('chip', at, { volume: 0.8, rate: 0.6 });
      },
      cheer: (at) => {
        crowd.react(at, 3, 'cheer');
        sound.play('cheer', at, { volume: 0.7 });
      },
      onRoster: (f) => showRoom(f),
    });
    drinkSync?.dispose();
    drinkSync = new DrinkSync(session, lounge, scene);
    pushFriend = friendShove(session, player, buzz);
    session.onCheers = (at, name) => {
      lounge.cheers(at, undefined, true);
      hud.toast(`Cheers with ${name}!`, 'win');
    };
    session.onChange = () => {
      showRoom(session?.friends ?? []);
      vrMenu.redraw();
    };
    mirror = new Mirror({
      session,
      roulette,
      craps,
      machines,
      piggy,
      hud,
      shadows: quality.shadows,
      chip: (at) => sound.play('chip', at, { volume: 0.5, rate: 0.95 + Math.random() * 0.1 }),
    });
    (window as unknown as { casino: Record<string, unknown> }).casino.mirror = mirror;
    showRoom([]);
    hud.toast(net.host ? `Room LAGO-${session.code} is open · press T to chat` : `Joined room LAGO-${session.code}`, 'win');
    (window as unknown as { casino: Record<string, unknown> }).casino.session = session;
    (window as unknown as { casino: Record<string, unknown> }).casino.drinkSync = drinkSync;
    vrMenu.redraw();
  };
  let me = { name: 'Guest', avatar: 0 };
  // Clink glasses with your friend: if they're close, they hear it and see it too.
  lounge.onCheers = () => {
    if (session?.friendNear(2.5)) session.emit('cheers');
  };
  setupLobby(
    (choice) => {
      enter.classList.add('done');
      me = { name: choice.name, avatar: choice.avatar };
      selfBody.setAvatar(choice.avatar);
      if (!isTouch) lock();
      else setTimeout(() => hud.toast('Drag to look · left stick to walk · tap to play', 'info'), 1600);
      if (choice.net) startSession(choice.net, choice.name, choice.avatar);
      if (choice.vr) void enterVR();
    },
    { vr: vrCapable },
  );
  // --- Your own body in VR ------------------------------------------------------
  const selfBody = new SelfBody(scene);
  selfBody.root.userData.noLand = true;
  hands.posed.left.root.userData.noLand = true;
  hands.posed.right.root.userData.noLand = true;
  selfBody.onSkin = (c) => hands.setSkin(c);
  selfBody.setAvatar(me.avatar);
  const fingerPoses = () => {
    const gp = (side: string) => interaction.gamepads().find((g) => g.handedness === side)?.gamepad;
    return { l: hands.fingerPose('left', gp('left')), r: hands.fingerPose('right', gp('right')) };
  };
  const gripValues = () => {
    const g = { l: 0, r: 0 };
    for (const { handedness, gamepad } of interaction.gamepads()) {
      const v = gamepad.buttons[1]?.value ?? 0;
      if (handedness === 'left') g.l = v;
      else if (handedness === 'right') g.r = v;
    }
    return g;
  };
  // --- Everything in the screen menus, in VR (left wrist) ----------------------------------
  const vrMenu = new VrMenu(hud.wrist, {
    hud,
    interaction,
    scene,
    camera,
    nav: () => hud.navItems,
    navigate: (item) => hud.onNavigate?.(item),
    session: () => session,
    host: async () => {
      const code = newCode();
      startSession({ transport: await connect(code, true), host: true }, me.name, me.avatar);
    },
    join: async (code) => {
      startSession({ transport: await connect(code, false), host: false }, me.name, me.avatar);
    },
    leaveRoom: () => {
      mirror?.dispose();
      mirror = null;
      session?.leave();
      session = null;
      drinkSync?.dispose();
      drinkSync = null;
      roomPill.hidden = true;
      voiceBtn.hidden = true;
      chatForm.hidden = true;
      hud.toast('You left the room', 'info');
    },
    avatar: () => me.avatar,
    setAvatar: (i) => {
      me.avatar = i;
      selfBody.setAvatar(i);
      session?.setAvatar(i);
      try {
        localStorage.setItem('lago.avatar', String(i));
      } catch {
        /* private mode */
      }
    },
    toggleMusic: () => document.getElementById('music')!.click(),
    toggleSound: () => document.getElementById('sound')!.click(),
    musicOn: () => document.getElementById('music')!.textContent === 'Music on',
    soundOn: () => !sound.muted,
    captionsOn: () => voices.captions,
    toggleCaptions: () => document.getElementById('captions')!.click(),
    resetChips: () => document.getElementById('reset')!.click(),
    exitVR: () => void xrSession?.end(),
    helpText: () => [...document.querySelectorAll('#help .card p')].map((p) => p.textContent ?? ''),
  });
  vrMenu.redraw();
  renderer.xr.addEventListener('sessionend', () => vrMenu.close());
  renderer.domElement.addEventListener('click', () => {
    // Clicking the room in free-cursor mode while standing re-captures the mouse.
    if (!player.seated && !player.pointerLocked && !player.inXR && enter.classList.contains('done') && !interaction.hoverLabel()) lock();
  });
  const mapBtn = document.getElementById('map-btn')!;
  mapBtn.addEventListener('click', () => hud.toggleMap());
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') hud.toggleMap();
    if (e.code === 'KeyE' && !player.inXR) {
      if (player.seated) {
        player.stand();
        lock();
      } else {
        const s = nearestSeat(1.8);
        if (s) player.sit(s.vp);
      }
    }
    if (e.code === 'Escape') hud.toggleMap(false);
  });

  // --- Welcome and daily top-up -----------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const bonus = bankroll.claimDailyBonus(today);
  night.resetBaseline();
  setTimeout(() => {
    hud.toast(bonus ? `Welcome to Palazzo Lago · daily bonus ${money(bonus)}` : 'Welcome back to Palazzo Lago', 'win');
  }, 900);
  // Two-step reset (no browser dialogs: they are blocked in embedded viewers).
  const resetBtn = document.getElementById('reset')!;
  let armed = 0;
  resetBtn.addEventListener('click', () => {
    if (bankroll.balance < 100 || performance.now() < armed) {
      armed = 0;
      resetBtn.textContent = 'Reset chips';
      bankroll.reset();
      hud.toast(`Chips reset to ${money(bankroll.balance)}`);
    } else {
      armed = performance.now() + 3000;
      resetBtn.textContent = 'Tap again to reset';
      setTimeout(() => (resetBtn.textContent = 'Reset chips'), 3000);
    }
  });

  // --- Sound -------------------------------------------------------------------
  const musicBtn = document.getElementById('music')!;
  musicBtn.addEventListener('click', () => {
    musicBtn.textContent = sound.toggleMusic() ? 'Music on' : 'Music off';
  });
  const soundBtn = document.getElementById('sound')!;
  soundBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    soundBtn.textContent = sound.muted ? 'Sound off' : 'Sound on';
  });
  const captionsBtn = document.getElementById('captions')!;
  const showCaptions = () => (captionsBtn.textContent = voices.captions ? 'Captions on' : 'Captions off');
  showCaptions();
  captionsBtn.addEventListener('click', () => {
    voices.setCaptions(!voices.captions);
    showCaptions();
  });
  const help = document.getElementById('help')!;
  document.getElementById('help-btn')!.addEventListener('click', () => help.classList.toggle('open'));
  help.addEventListener('click', () => help.classList.remove('open'));
  // Jumping and the pool: splashes, strokes, landings, the underwater look.
  const swim = new SwimFX(scene, camera, sound.listener);
  player.jumpAllowed = () => !hud.station && (document.getElementById('chat') as HTMLElement | null)?.hidden !== false;
  player.onSplash = (at, k) => {
    sound.play('splash', at, { volume: 0.5 + k * 0.6, rate: 1.1 - k * 0.25 });
    swim.splash(at, k);
  };
  player.onStroke = (at) => {
    sound.play('swim', at, { volume: 0.55, rate: 0.85 + Math.random() * 0.3 });
    swim.ripple(at, 0.45);
  };
  player.onLand = (at, k) => sound.play('land', at, { volume: 0.3 + k * 0.5 });
  player.onStep = (surface, run) => {
    const name = surface === 'carpet' ? 'stepCarpet' : surface === 'stone' ? 'stepStone' : 'stepMarble';
    sound.playLocal(name, (surface === 'carpet' ? 0.45 : 0.3) * (run ? 1.2 : 1), 0.9 + Math.random() * 0.2);
  };
  const fountainVoice = sound.ambientAt('water', casino.fountainAnchor, { volume: 0.6, ref: 30, rolloff: 0.9 });

  // --- VR -------------------------------------------------------------------
  const vrBtn = document.getElementById('vr') as HTMLButtonElement;
  let xrSession: XRSession | null = null;
  async function enterVR() {
    if (!xr || !vrCapable) return;
    if (xrSession) return xrSession.end();
    enter.classList.add('done');
    if (document.pointerLockElement) document.exitPointerLock();
    try {
      xrSession = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    } catch (e) {
      hud.toast(`Couldn't start VR: ${(e as Error).message}`, 'warn');
      return;
    }
    xrSession.addEventListener('end', () => {
      xrSession = null;
      vrBtn.textContent = 'Enter VR';
    });
    await renderer.xr.setSession(xrSession);
    vrBtn.textContent = 'Exit VR';
    // Head pose is known after the first XR frame; then put the player where they were.
    const where: Viewpoint = { ...lobby, position: player.feet(), yaw: player.rig.rotation.y };
    setTimeout(() => {
      player.place(where);
      player.current = null;
      crew.regroup();
    }, 120);
  }
  if (vrCapable) {
    vrBtn.hidden = false;
    vrBtn.addEventListener('click', () => void enterVR());
  }

  // Portrait phones get a taller field of view so you still see the room, not a slice.
  const post = new PostFX(renderer, scene, camera, quality);
  const fitCamera = () => {
    camera.aspect = innerWidth / innerHeight;
    const hfov = 74;
    const v = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / camera.aspect) * 180) / Math.PI;
    camera.fov = THREE.MathUtils.clamp(v, 58, 92);
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post?.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', fitCamera);
  fitCamera();

  // Adaptive resolution: drop the render scale if the frame rate sags, raise it when there's room.
  let pixelRatio = quality.pixelRatio;
  let fpsFrames = 0,
    fpsSince = performance.now(),
    goodFor = 0;
  const adapt = () => {
    fpsFrames++;
    const now = performance.now();
    if (now - fpsSince < 1500) return;
    const fps = (fpsFrames * 1000) / (now - fpsSince);
    fpsFrames = 0;
    fpsSince = now;
    if (renderer.xr.isPresenting || document.hidden) return;
    if (fps < 34 && pixelRatio > quality.minPixelRatio) {
      pixelRatio = Math.max(quality.minPixelRatio, pixelRatio - 0.15);
      renderer.setPixelRatio(pixelRatio);
      post.setSize(innerWidth, innerHeight);
      goodFor = 0;
    } else if (fps > 55 && pixelRatio < quality.pixelRatio && ++goodFor >= 3) {
      pixelRatio = Math.min(quality.pixelRatio, pixelRatio + 0.1);
      renderer.setPixelRatio(pixelRatio);
      post.setSize(innerWidth, innerHeight);
      goodFor = 0;
    }
  };

  // On-screen controls for the game you are at (all screens; essential on phones).
  const rouletteControls = (): Control[] => {
    const betting = roulette.game.phase === 'betting';
    const has = roulette.game.bets.size > 0;
    return [
      ...CHIP_DENOMS.map((d) => ({
        id: `chip${d}`,
        label: chipLabel(d),
        kind: 'chip' as const,
        color: CHIP_COLORS[d],
        active: roulette.chip === d,
        onPress: () => roulette.selectChip(d),
      })),
      { id: 'undo', label: 'Undo', disabled: !roulette.canUndo, onPress: () => roulette.undo() },
      { id: 'clear', label: 'Clear', disabled: !betting || !has, onPress: () => roulette.clear() },
      { id: 'rebet', label: 'Rebet', disabled: !roulette.game.canRebet, onPress: () => roulette.rebet() },
      { id: 'double', label: '×2', disabled: !betting || !has, onPress: () => roulette.double() },
      {
        id: 'spin',
        label: betting ? 'SPIN' : '…',
        sub: `bet ${money(roulette.game.totalBet)}`,
        kind: 'primary',
        disabled: !betting || !has,
        onPress: () => roulette.startSpin(),
      },
    ];
  };
  const crapsControls = (): Control[] => [
    ...CHIP_DENOMS.map((d) => ({
      id: `chip${d}`,
      label: chipLabel(d),
      kind: 'chip' as const,
      color: CHIP_COLORS[d],
      active: craps.chip === d,
      onPress: () => craps.selectChip(d),
    })),
    { id: 'undo', label: 'Undo', disabled: !craps.canUndo, onPress: () => craps.undo() },
    { id: 'clear', label: 'Down', sub: 'take bets down', disabled: !craps.canClear, onPress: () => craps.clear() },
    { id: 'odds', label: 'Odds', sub: '3-4-5x', disabled: !craps.canOdds, onPress: () => craps.maxOdds() },
    {
      id: 'roll',
      label: craps.phase === 'betting' ? 'ROLL' : '…',
      sub: craps.game.point ? `point ${craps.game.point}` : 'come-out',
      kind: 'primary',
      disabled: !craps.canRoll,
      onPress: () => craps.throwDice(),
    },
  ];
  const piggyControls = (m: PiggyMachineView): Control[] => {
    const idle = m.canChangeBet;
    return [
      { id: 'info', label: 'Info', active: m.mode === 'info', disabled: !idle && m.mode !== 'info', onPress: () => m.toggleInfo() },
      { id: 'bet-', label: '−', sub: 'bet', disabled: !idle, onPress: () => m.changeBet(-1) },
      { id: 'betv', label: money(m.bonusBet), sub: 'per spin', disabled: true, onPress: () => {} },
      { id: 'bet+', label: '+', sub: 'bet', disabled: !idle, onPress: () => m.changeBet(1) },
      { id: 'max', label: 'Max', disabled: !idle, onPress: () => m.maxBet() },
      { id: 'spin', label: m.spinLabel, sub: m.spinSub, kind: 'primary', disabled: !m.spinEnabled, onPress: () => m.onSpinPressed() },
    ];
  };
  const slotControls = (m: SlotMachineView): Control[] => {
    const idle = m.mode !== 'spinning' && m.game.phase === 'idle';
    return [
      { id: 'info', label: 'Info', active: m.mode === 'info', disabled: m.mode === 'spinning' || m.mode === 'pick', onPress: () => m.toggleInfo() },
      { id: 'bet-', label: '−', sub: 'bet', disabled: !idle, onPress: () => m.changeBet(-1) },
      { id: 'betv', label: money(m.game.phase === 'freeSpins' ? m.game.freeSpinBet : m.game.bet), sub: 'per spin', disabled: true, onPress: () => {} },
      { id: 'bet+', label: '+', sub: 'bet', disabled: !idle, onPress: () => m.changeBet(1) },
      { id: 'max', label: 'Max', disabled: !idle, onPress: () => m.maxBet() },
      {
        id: 'spin',
        label: m.mode === 'spinning' ? 'STOP' : m.game.phase === 'freeSpins' ? 'FREE' : 'SPIN',
        sub: m.mode === 'pick' ? 'pick on screen' : m.game.phase === 'freeSpins' ? `${m.game.freeSpinsLeft} left` : '',
        kind: 'primary',
        disabled: m.mode === 'pick',
        onPress: () => m.onSpinPressed(),
      },
    ];
  };
  let finaleSeen = false;

  // --- Frame loop --------------------------------------------------------------
  const timer = new THREE.Timer();
  const stats = new URLSearchParams(location.search).has('stats') ? document.getElementById('stats') : null;
  let frames = 0,
    since = performance.now();
  let first = true;
  const head = new THREE.Vector3();
  let casinoThings: THREE.Object3D[] | null = null;
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
    interaction.update();
    player.update(dt, interaction);
    player.rig.updateMatrixWorld(true);
    camera.getWorldPosition(head);
    hands.head.copy(head);
    hands.update();
    const feet = player.feet();

    // Which game are you at? Sitting, or standing close in VR / free mode.
    const at = player.seated?.id ?? nearestSeat(player.inXR ? 1.6 : 1.3)?.vp.id ?? null;
    if (at !== hud.station) hud.setStation(at);
    if (!player.inXR) {
      let label = interaction.hoverLabel();
      if (!label && !player.seated) {
        const s = nearestSeat(1.8);
        if (s) label = `E · ${s.label}`;
      }
      hud.setAim(player.pointerLocked, label);
    }

    roulette.update(dt);
    craps.update(dt);
    session?.update(dt);
    drinkSync?.update();
    mirror?.update(dt);
    // Walk up to craps in VR and the stickman slides you the dice.
    if (player.inXR && hud.station === 'craps') craps.offerDice(feet);
    {
      const on = player.inXR;
      hands.showControllers(!on);
      if (on) {
        // Your hands first (they sit on the controllers), then the body's arms reach them.
        hands.poseHands(fingerPoses());
        const head = camera.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
        selfBody.update(dt, { on, head, dir, floorY: player.rig.position.y, hands: { l: hands.wrist('left'), r: hands.wrist('right') }, poses: fingerPoses(), wrists: { l: hands.wristPose('left'), r: hands.wristPose('right') }, speed: player.speed });
      } else selfBody.update(dt, { on: false, head: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), floorY: 0, hands: { l: null, r: null }, poses: { l: [...OPEN] as FingerPose, r: [...OPEN] as FingerPose }, speed: 0 });
    }
    for (const m of machines) m.update(dt);
    piggy.update(dt);
    slotRows.update(t, feet);
    lounge.update(dt);
    throwables.update(dt);
    bodies.update(dt);
    crowd.update(dt, t, feet, head);
    casino.update(t, feet);
    areas.update(dt, t, feet);
    swim.update(dt, player.underwater);
    // Zone culling: only draw the parts of the resort you could possibly see from here.
    if (!casinoThings) {
      casinoThings = scene.children.filter(
        (o) => o.type === 'Group' && !o.name && o !== player.rig && o !== crowd.group && o !== selfBody.root && Math.abs(o.position.x) < 18 && Math.abs(o.position.z) < 14,
      );
    }
    {
      const fx = feet.x;
      const show = (name: string, v: boolean) => {
        const g = scene.getObjectByName(name);
        if (g && g.visible !== v) g.visible = v;
      };
      const inSuite = fx > 500;
      const onDeck = fx > 21 && feet.z < -0.2 && !inSuite;
      show('suite', inSuite);
      show('pool', !inSuite && fx > 16);
      show('hotel', !inSuite && fx > 4);
      show('casino', !inSuite && !onDeck);
      const inCasino = !inSuite && !onDeck;
      for (const o of casinoThings) if (o.visible !== inCasino) o.visible = inCasino;
    }
    hud.update(camera);
    crew.update(dt);
    dialogue.update(dt);
    voices.update();
    night.update(dt);
    adapt();

    roulette.setPanelVisible(player.inXR);
    craps.setPanelVisible(player.inXR);
    // Game controls, the touch context button, and seated state for the layout.
    document.body.classList.toggle('seated', !!player.seated);
    if (!player.inXR) {
      // Walk up and play: the game's controls show as soon as you're at it, sitting or not.
      const station = hud.station;
      const m = machines.find((mm) => mm.machine.id === station);
      hud.setControls(station === 'roulette' ? rouletteControls() : station === 'craps' ? crapsControls() : m ? slotControls(m) : station === piggy.machine.id ? piggyControls(piggy) : null);
      if (lounge.holdingDrink) touch.setAction('Sip', () => lounge.sipHeld());
      else if (player.seated) touch.setAction('Stand', () => player.stand());
      else {
        const s = nearestSeat(1.8);
        touch.setAction(s ? (s.vp.id === 'roulette' ? 'Sit' : 'Play') : null, s ? () => player.sit(s.vp) : null);
      }
      touch.setJump(!player.seated && !hud.station);
    } else hud.setControls(null);

    // Croupier invites bets again after each spin.
    if (placeBetsTimer > 0) {
      placeBetsTimer -= dt;
      if (placeBetsTimer <= 0 && near(roulette.group.position, 5)) croupierSays(CROUPIER_LINES.place);
    }
    if (crapsBetsTimer > 0) {
      crapsBetsTimer -= dt;
      if (crapsBetsTimer <= 0 && near(craps.group.position, 6)) stickSays('New shooter coming out! Get your line bets down.');
    }
    // Waiters stop and offer when they pass close by.
    const now = performance.now() / 1000;
    for (const w of waiters) {
      const d = w.pos.distanceTo(feet);
      if (d < 1.4 && now - lastOffer > 45 && !lounge.holdingDrink && w.pause <= 0) {
        w.pause = 4;
        w.yaw = Math.atan2(feet.x - w.pos.x, feet.z - w.pos.z);
        lastOffer = now;
        hud.toast('“Champagne?” Click the waiter (or point and trigger) to take a glass.', 'info');
      }
    }
    // Outside: the room tone fades and the fountains swell with the show.
    // (Only the lakeside terrace counts here; the pool deck has its own party.)
    const outside = Math.abs(feet.x) < 14 ? THREE.MathUtils.clamp((-14 - feet.z) / 2, 0, 1) : 0;
    const doorway = Math.max(outside, casino.doorsOpen() * 0.4);
    sound.setAmbience(1 - outside * 0.75);
    // Music: lively on the floor, softer by the piano and outside.
    const byPiano = THREE.MathUtils.clamp(1 - feet.distanceTo(lounge.piano.position) / 7, 0, 1);
    sound.setMusicLevel(Math.max(0.2 * (1 - outside * 0.6) * (1 - byPiano * 0.8), 0.45 * areas.musicLevel(feet)));
    if (outside > 0.5) {
      if (!finaleSeen && casino.fountainLevel() > 0.8) {
        finaleSeen = true;
        night.complete('finale');
        crew.react('finale', { force: true, cheer: true });
      } else if (Math.random() < 0.002) crew.react('terrace', { chance: 0.6 });
    }
    fountainVoice.setVolume((0.25 + casino.fountainLevel() * 0.9) * (0.25 + doorway * 0.75));

    // Count the whole frame (all post passes), not just the last one.
    renderer.info.autoReset = false;
    renderer.info.reset();
    post.render(scene, camera);
    if (first) {
      first = false;
      document.getElementById('loading')!.classList.add('done');
    }
    if (stats) {
      frames++;
      const nowMs = performance.now();
      if (nowMs - since > 500) {
        const info = renderer.info.render;
        stats.textContent = `${quality.label} · ${Math.round((frames * 1000) / (nowMs - since))} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris · ${crowd.people.length} people`;
        frames = 0;
        since = nowMs;
      }
    }
  });

  (window as unknown as { casino: unknown }).casino = { scene, renderer, player, areas, roulette, craps, machines, piggy, bankroll, hud, quality, crowd, world, lounge, hands, interaction, crew, night, touch, sound, POSE, FINGER, THUMB, curlFingers, setFingers, dialogue, selfBody, voices, throwables, bodies };
}

main().catch((e) => {
  console.error(e);
  document.getElementById('loading')!.textContent = 'Something went wrong starting the casino. ' + String(e);
});
