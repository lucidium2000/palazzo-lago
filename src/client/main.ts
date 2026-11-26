import * as THREE from 'three';
import { Bankroll, type BankrollState } from '../rules/bankroll';
import { DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY } from '../rules/machines';
import { pocketColor, pocketLabel } from '../rules/roulette';
import { CryptoRng } from '../rules/rng';
import { Sound } from './audio';
import { buildCasino, envZoneAt, POSITIONS, registerHall, SLOTS_YAW, type EnvZone } from './casino';
import { preloadChips } from './chips';
import { CrapsTable } from './craps/table';
import { PostFX } from './post';
import { Dialogue, voiceArbiter } from './dialogue';
import { AREA_NODES, buildAreas, registerAreas } from './areas';
import { DECK, POOL, WATER_Y } from './areas/pool';
import { BeachBalls } from './beachball';
import { Session } from './net/session';
import { MAX_PLAYERS, PLAYER_COLORS, signedMoney, type AreaId } from './net/party';
import { Mirror } from './net/mirror';
import { setupLobby } from './net/lobby';
import { connect, newCode, type Transport } from './net/transport';
import { VrMenu } from './vrmenu';
import { SelfBody } from './selfbody';
import { SwimFX } from './areas/swim';
import { OPEN, type FingerPose } from './fingers';
import { FINGER, THUMB, curlFingers, makeMouth, setFingers, setOpen } from './net/embody';
import { bakeStatic } from './merge';
import { buildBlackjack } from './pit';
import { BlackjackPlay } from './blackjackplay';
import { BlackjackSync } from './net/bjsync';
import { buildPokerRoom, registerPokerRoom } from './pokerroom';
import { PokerPlay } from './pokerplay';
import { PokerSync } from './net/pokersync';
import { SlotRows } from './decor';
import { money, type GameContext } from './game';
import { Hands } from './hands';
import { Hud, type NavItem } from './hud';
import { Interaction } from './interaction';
import { Drink, Lounge } from './lounge';
import { WaiterTrays } from './waitertray';
import { Napkins } from './napkins';
import { showVersion } from './version';
import { BAR as POOL_BAR } from './areas/pool';
import { Crowd, POSE, randomLook, staffLook, type Person } from './people';
import { saveComfort, Player, type Viewpoint } from './player';
import { detectTier } from './quality';
import { WHEEL_CENTER } from './roulette/layout';
import { RouletteTable } from './roulette/table';
import { SlotMachineView } from './slots/machine';
import { PiggyMachineView } from './slots/piggy';
import { SEAT_R, World } from './world';
import { ColliderDebug } from './colliderdebug';
import { assets } from './assets';
import { Crew } from './crew';
import { LiftSync } from './net/liftsync';
import { Night } from './night';
import { TouchControls } from './touch';
import type { Control } from './hud';
import { CHIP_COLORS, CHIP_DENOMS, chipLabel } from './textures';
import { CROUPIER_LINES, STAFF, TIPSY_LINES, rouletteCall } from './speech';
import { mouthOf, voices } from './voices';
import { Faces } from './faces';
import { Throwables } from './throwables';
import { DrinkPhysics } from './drinkphysics';
import { Listener } from './listen';
import { Watch } from './watch';
import { PhotoCams } from './photocam';
import { elVoice } from './cast';
import type { ReactKind } from './reactlines';
import { DrinkSync } from './net/drinksync';
import { PhotoSync } from './net/photosync';
import { LooseObjects } from './loose';
import { LooseSync } from './net/loosesync';
import { Party } from './party';
import { renderPartyTrack } from './party/track';
import { DJ } from './areas/pool';
import { Boxing } from './net/boxing';
import { NpcSync } from './net/npcsync';
import { Bodies, friendShove } from './bodies';
import { avatarLook } from './net/avatars';
import { Piano } from './piano';
import { PianoSync } from './net/pianosync';

const SAVE_KEY = 'palazzo-lago.bankroll.v1';

/** How the parts of the resort read on the room's scoreboard. */
const AREA_NAMES: Record<AreaId, string> = { casino: 'casino', pool: 'pool', hotel: 'hotel', suite: 'suite' };

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
  // Loading progress: three steps (assets, building the resort, lighting each area), a bar, time, tips.
  showVersion();
  const loadT0 = performance.now();
  const loadBar = document.querySelector('#loading .bar i') as HTMLElement | null;
  const loadMeta = document.querySelector('#loading .meta');
  const loadTip = document.querySelector('#loading .tip');
  const TIPS = [
    'Tip: in VR, look at the watch on your left wrist and tap it for the menu.',
    'Tip: press buttons by touching them with your index finger.',
    'Tip: answer people out loud: "yes", "no", or a reply\'s words.',
    'Tip: swing and let go to throw a drink. Glasses break!',
    'Tip: host a room and up to 3 friends can join with the code.',
    'Tip: the poker room is through the gilded door on the west side of the casino.',
    'Tip: the pool party has a DJ. Throw your hands up on the drop.',
  ];
  let tipIx = Math.floor(Math.random() * TIPS.length);
  if (loadTip) loadTip.textContent = TIPS[tipIx];
  const tipTimer = setInterval(() => {
    tipIx = (tipIx + 1) % TIPS.length;
    if (loadTip) loadTip.textContent = TIPS[tipIx];
  }, 5000);
  /** Overall progress 0..1 with a step label: shows %, elapsed and (once it can tell) time left. */
  const loadStep = { name: '', t: 0, k: 0 };
  const loadProgress = (k: number, label: string) => {
    if (loadingSub) loadingSub.textContent = label;
    if (loadBar) loadBar.style.width = `${Math.round(k * 100)}%`;
    const t = performance.now() / 1000;
    const el = t - loadT0 / 1000;
    // Time left from the pace of the current step (lighting is much slower per % than loading).
    const step = label.slice(0, 11);
    if (step !== loadStep.name) Object.assign(loadStep, { name: step, t, k });
    const dk = k - loadStep.k;
    const left = k >= 1 ? null : dk > 0.04 ? Math.max(1, Math.round(((t - loadStep.t) / dk) * (1 - k))) : null;
    if (loadMeta) loadMeta.textContent = `${Math.round(k * 100)}% · ${Math.round(el)} s${left !== null ? ` · about ${left} s to go` : k < 1 ? ' · estimating…' : ''}`;
  };
  await assets.load(renderer, (k) => loadProgress(k * 0.35, 'Step 1 of 3 · Opening the doors'));
  loadProgress(0.36, 'Step 2 of 3 · Building the resort');
  await new Promise((r) => setTimeout(r, 30));

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
  registerPokerRoom(world);
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
  // Faces up close: lips that follow the words, blinking, eyes that look at you.
  const faces = new Faces(crowd.group, { radius: 6, max: quality.name === 'desktop' ? 10 : 6, level: (p) => voices.mouthLevel(p) });
  // Beyond the casino floor: hotel corridor, elevator lobby, pool deck, Suite 3201.
  const areas = buildAreas({ scene, quality, interaction, sound, player, world, toast: (t) => hud.toast(t, 'info') });

  // --- Games -------------------------------------------------------------------
  const roulette = new RouletteTable(ctx, POSITIONS.roulette);
  world.addLocalBox(roulette.group, -0.28, -0.02, 2.95, 1.15, 'table');
  world.addLocalBox(roulette.group, WHEEL_CENTER.x - 0.62, -0.25, 0.3, 0.3, 'table');
  // Its stools are seats: walk onto one and you sit (see world.addSeat).
  for (const x of [-0.75, 0.95]) world.addLocalSeat(roulette.group, x, 0.98, SEAT_R, 0.72, Math.PI, 'table stool');
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
    world.addLocalBox(view.group, 0, 0.0, 0.76, 0.72, 'slot machine');
    world.addLocalSeat(view.group, 0, 0.78, SEAT_R, 0.7, Math.PI, 'slot stool');
    return view;
  });
  // Porkbelly Payday: a premium cabinet at the end of the slot bank.
  const piggy = (() => {
    const off = 1.95;
    const right = new THREE.Vector3(Math.cos(SLOTS_YAW), 0, -Math.sin(SLOTS_YAW));
    const fwd = new THREE.Vector3(Math.sin(SLOTS_YAW), 0, Math.cos(SLOTS_YAW));
    const pos = POSITIONS.slots.clone().addScaledVector(right, off).addScaledVector(fwd, -off * 0.12);
    const view = new PiggyMachineView(ctx, pos, SLOTS_YAW - off * 0.22);
    world.addLocalBox(view.group, 0, 0.0, 0.86, 0.72, 'slot machine');
    world.addLocalSeat(view.group, 0, 0.86, SEAT_R, 0.7, Math.PI, 'slot stool');
    return view;
  })();
  const craps = new CrapsTable(ctx, POSITIONS.craps);
  world.addLocalBox(craps.group, 0, 0, 3.75, 1.7, 'table');

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
  // Drinks obey physics: pour them, crash them together, splash people.
  const drinkPhysics = new DrinkPhysics({
    scene,
    camera,
    lounge,
    throwables,
    hands,
    crowd,
    sound,
    world,
    inXR: () => player.inXR,
    douse: (p, c) => drinkSync?.douse(p, c) ?? false,
    react: (p, kind) => reactTo(p, kind),
  });
  // Loose things to pick up and throw: chips, dice, bottles, fruit, napkins, menus, ashtrays, buckets.
  const hitBy = new WeakMap<object, Person>();
  // Napkins wipe up spills, your face, and (gently) the person you soaked.
  let napkins: Napkins | null = null;
  const loose = new LooseObjects({ scene, camera, world, sound, hands, interaction, hud, player, lounge, throwables, drinkPhysics, roulette: roulette.group, craps: craps.group });
  const slotRows = new SlotRows(ctx, crowd, world);

  // Walking routes through the open floor; edges are found automatically.
  crowd.setGraph([
    ...AREA_NODES,
    [0, 12], [-4.5, 11.8], [4.5, 11.8], [0, 8.6], [-3.6, 7.6], [3.6, 7.6],
    [6.6, 2], [4.8, -2.8], [0, -4.6], [-4.8, -2.8], [-6.6, 2], [-4.4, 7.0], [4.4, 7.0],
    [-11, -2.5], [-11.2, 4.5], [-4.5, -10.5], [-10.5, -11], [3.8, -11.2], [0, -12.4],
    [9.2, -6.5], [9.4, -11.5], [9.4, -1.8], [14.6, -11.5], [14.6, -6], [14.6, -1.2],
    [10.5, 10.5], [14.5, 10], [12.5, 1.2], [-10.1, 9.8], [-13.3, 9.0], [-9, 12.4],
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
  const blackjacks: BlackjackPlay[] = [];
  /** Free stools at the blackjack tables: sit down (or walk onto one) and play. */
  const bjSeats: { table: number; k: number; vp: Viewpoint }[] = [];
  let bjSync: BlackjackSync | null = null;
  for (const spec of [
    { x: -11.1, z: -4.4, yaw: 0, felt: '#1d5a3a', min: 25, max: 5000 },
    { x: -3.95, z: -4.4, yaw: 0, felt: '#123f6a', min: 100, max: 10000 },
  ]) {
    const t = buildBlackjack(quality, spec);
    scene.add(t.group);
    bakeStatic(t.group, { shadows: quality.shadows });
    world.addLocalBox(t.group, 0, 0.37, 2.3, 1.36, 'table');
    for (const st of t.seats) world.addSeat(st.pos.x, st.pos.z, SEAT_R, 0.745, st.yaw, 'table stool');
    const dealer = crowd.add('croupier', staffLook('dealerF'), t.dealer.pos, t.dealer.yaw);
    const players: { seat: number; person: Person | null }[] = [];
    for (const k of quality.name === 'quest2' || quality.name === 'mobile' ? [1, 4] : [0, 2, 3, 5]) {
      const st = t.seats[k];
      const p = crowd.add('patron', randomLook(), st.pos, st.yaw);
      if (p) p.seatY = 0.72;
      players.push({ seat: k, person: p ?? null });
    }
    // The dealer deals real hands to them while you're nearby.
    const index = blackjacks.length;
    const bj = new BlackjackPlay(
      {
        sound,
        bankroll,
        toast: (text, kind) => hud.toast(text, kind ?? 'info'),
        haptic: (side, s, ms) => buzz(side, s, ms),
        interaction,
        name: () => me.name,
        onResult: (staked, returned) => {
          if (session && returned >= Math.max(staked * 2.5, 250)) session.bigWin('blackjack', returned);
        },
      },
      t,
      dealer ?? null,
      players,
      spec.min,
      spec.max,
      index,
    );
    blackjacks.push(bj);
    for (const k of bj.freeSeats) {
      const st = t.seats[k];
      const tableAt = new THREE.Vector3(spec.x, 0, spec.z);
      bjSeats.push({
        table: index,
        k,
        vp: {
          id: `bj${index}s${k}`,
          label: 'Blackjack',
          position: st.pos.clone(),
          yaw: st.yaw + Math.PI,
          pitch: -0.72,
          eye: 1.42,
          back: 0.05,
          portrait: { at: st.pos.clone().lerp(tableAt, 0.12), yaw: st.yaw + Math.PI, back: 0.35, eye: 2.15, pitch: -0.95 },
        },
      });
    }
  }
  // The poker room: a private card salon through the doorway in the west wall,
  // a dealer and six regulars at the Hold'em table (they give up a chair for you).
  const pokerRoom = buildPokerRoom(quality);
  scene.add(pokerRoom.shell);
  pokerRoom.interior.name = 'pokerroom';
  scene.add(pokerRoom.interior);
  bakeStatic(pokerRoom.shell, { shadows: quality.shadows });
  bakeStatic(pokerRoom.interior, { shadows: quality.shadows });
  const pokerDealer = crowd.add('croupier', staffLook('dealerF'), pokerRoom.dealer.pos, pokerRoom.dealer.yaw);
  const pokerGuests = pokerRoom.seats.map((s) => {
    const look = randomLook();
    const p = crowd.add('patron', look, s.pos, s.yaw);
    if (p) {
      p.seatY = 0.62;
      // The card game seats and stands them itself (they give up a chair for you).
      p.keepSeat = true;
    }
    return { person: p ?? null, female: look.dress };
  });
  const poker = new PokerPlay(
    {
      sound,
      bankroll,
      rng: ctx.rng,
      toast: (text, kind) => hud.toast(text, kind ?? 'info'),
      say: (text) => hud.say('Dealer', text),
      haptic: (side, s, ms) => buzz(side, s, ms),
      name: () => me.name,
      head: () => camera.getWorldPosition(new THREE.Vector3()),
      velocity: (h) => hands.velocity(h),
      onResult: (staked, returned) => {
        if (session && returned >= Math.max(staked * 3, 500)) session.bigWin('poker', returned);
      },
      leave: () => {
        player.stand();
        player.place(pokerView);
      },
    },
    pokerRoom,
    pokerDealer ?? null,
    pokerGuests,
  );
  let pokerSync: PokerSync | null = null;
  /** Chairs at the poker table: sit down (or walk onto one) and play. */
  const pkSeats: { k: number; vp: Viewpoint }[] = pokerRoom.seats.map((st, k) => ({
    k,
    vp: {
      id: `pk${k}`,
      label: 'Poker',
      position: st.pos.clone(),
      yaw: st.yaw + Math.PI,
      pitch: -0.66,
      eye: 1.36,
      back: -0.12,
      portrait: { at: st.pos.clone().lerp(pokerRoom.table.position, 0.1), yaw: st.yaw + Math.PI, back: 0.4, eye: 1.95, pitch: -0.9 },
    },
  }));
  const pokerView: Viewpoint = { id: 'poker', label: 'Poker Room', position: new THREE.Vector3(-19.4, 0, 1.7), yaw: Math.atan2(2.9, 1.7), pitch: -0.2, eye: 1.65 };
  let crapsBetsTimer = 0;
  const stickSays = (text: string) => {
    const dur = voices.talk({ who: 'Stickman', text, voice: elVoice('stickman'), alt: STAFF.stickman, at: stickman ? mouthOf(stickman) : null, priority: true, group: 'stickman', fallback: { pitch: 1.05, rate: 1.05, voice: 1 } });
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
      label: () => (waiterTrays.glasses(w) > 0 ? 'Take a glass of champagne' : 'Her tray is empty (back from the bar soon)'),
      enabled: () => !w.tray || waiterTrays.glasses(w) > 0,
      onSelect: () => {
        // A glass off her tray (no rig, no tray: one appears in your hand as before).
        if (w.tray) waiterTrays.serve(w);
        else lounge.offerChampagne();
        w.pause = Math.max(w.pause, 1.5);
        lastOffer = performance.now() / 1000;
      },
    });
  }
  // Their trays hold real glasses: reach out and take one.
  const waiterTrays = new WaiterTrays({ crowd, lounge, hands, inXR: () => player.inXR, feet: () => player.feet() }, waiters);
  // Your crew for the night, and the shape of the night.
  const crew = new Crew(crowd, world, player, hud, sound, randomLook);
  // Elevators: NPCs standing in a cab ride along; your crew, if they're with you, come too.
  {
    const lifts = areas.elevators;
    const toastRide = lifts.onRide;
    lifts.passengers = () => crowd.people.filter((p) => !p.driven && !crew.buddies.some((b) => b.person === p));
    lifts.onRide = (dest, info) => {
      toastRide?.(dest, info);
      crew.rideAlong(info.from, info.to);
    };
  }
  // People are solid: you squeeze past them, and push them if you keep going.
  let pushFriend: ((dx: number, dz: number) => void) | null = null;
  /** Someone you got physical with says so (see Dialogue.react). */
  const reactTo = (p: Person, kind: ReactKind): number => {
    const b = crew.buddies.find((x) => x.person === p);
    return dialogue.react(p, kind, b ? { name: b.name, voice: b.voiceId } : undefined);
  };
  const bodies = new Bodies({
    crowd,
    world,
    player,
    hands,
    onBump: (p, k) => {
      // They notice: a word (in their own voice), or at least a breath for the lightest brush.
      if (k > 0.2 && reactTo(p, 'pushed') > 0) return;
      if (k > 0.1) sound.play('gasp', p.pos, { volume: 0.1 + 0.3 * k, rate: 1.2 + Math.random() * 0.25 });
    },
    onPunch: (p, power, at) => {
      // A thud you feel, a stumble, and a loud ouch.
      sound.play('punch', at, { volume: 0.9 + power * 0.6, rate: 0.85 + Math.random() * 0.15 });
      p.gaspT = Math.max(p.gaspT, 1);
      reactTo(p, 'punched');
    },
    isFist: (h) => {
      const g = gripValues();
      return (h.ctrl.userData.handedness === 'left' ? g.l : g.r) > 0.55;
    },
    onPushFriend: (_p, dx, dz) => pushFriend?.(dx, dz),
    onUnseat: (p, ux, uz, power) => piano?.knocked(p, ux, uz, power),
    onReseat: (p) => piano?.reseated(p),
    seatTaken: (x, z) => !!piano?.benchTaken(x, z),
  });
  // The grand piano: 88 keys you can play (fingertips in VR, the keyboard or a tap on a screen).
  let piano: Piano | null = null;
  piano = new Piano({
    group: lounge.piano,
    keyFrame: lounge.keyFrame,
    soundboard: lounge.soundboard,
    pianist: lounge.pianist,
    loop: lounge.pianoLoop,
    scene,
    camera,
    dom: renderer.domElement,
    player,
    hands,
    interaction,
    bodies,
    sound,
    hud,
    light: quality.name === 'quest2' || quality.name === 'mobile' || quality.name === 'quest3',
    haptic: (side, s, ms) => buzz(side, s, ms),
    fingerPoses: () => fingerPoses(),
    gamepads: () => interaction.gamepads(),
    react: (p, kind) => reactTo(p, kind),
  });
  const night = new Night(scene, hud, sound, crew, crowd, bankroll);
  // Guests talk among themselves, and to you when you stop and look at them.
  const startChips = bankroll.balance;
  // Answer people out loud (voice replies): browser speech recognition, or offline Vosk on Quest.
  const listener = new Listener();
  let listenHint = 0;
  listener.onState = (st) => {
    document.body.classList.toggle('listening', st === 'listening');
    if (st === 'listening' && performance.now() - listenHint > 20000) {
      listenHint = performance.now();
      hud.toast('🎤 Listening… answer out loud (or pick a reply)', 'info');
    }
  };
  const dialogue = new Dialogue({
    listener,
    scene,
    camera,
    crowd,
    sound,
    hud,
    interaction,
    feet: () => player.feet(),
    inXR: () => player.inXR,
    playerFemale: () => {
      const l = avatarLook(me.avatar);
      return (l.kind ?? '').startsWith('female') || !!l.dress;
    },
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
    const dur = voices.talk({ who: 'Croupier', text, voice: elVoice('croupier'), alt: STAFF.croupier, at: croupier ? mouthOf(croupier) : null, priority: true, group: 'croupier', fallback: { pitch: 0.9, rate: 0.95, voice: 0 } });
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

  // The pool party has its own share of the crowd (see Crowd: it's out of sight of the floor and vice versa).
  areas.populate(crowd);
  // The DJ's set, the beat, the lights and the dancing (party/index.ts).
  const party = new Party({
    scene,
    renderer,
    camera,
    sound,
    crowd,
    dj: DJ,
    lights: areas.pool.party,
    poles: [
      [42, -34],
      [58, -34],
    ],
    dancers: areas.dancers,
    performers: areas.performers,
    where: (p) => areas.where(p),
    toast: (t) => hud.toast(t, 'info'),
    hands,
    interaction,
    travel: (v) => player.travel(v),
  });

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
  const wanderers = crowd.capacity - crowd.people.length - 1;
  for (let i = 0; i < wanderers; i++) crowd.add('wander', randomLook(), crowd.randomNode());
  // Beach balls at the pool party: one floating in the shallow end, one on the deck.
  const beachBalls = new BeachBalls({
    scene,
    world,
    crowd,
    player,
    hands,
    interaction,
    camera,
    sound,
    spawns: [new THREE.Vector3(POOL.x - 3, WATER_Y + 0.3, POOL.z - 1.2), new THREE.Vector3(34.2, 0.3, -11.6)],
    home: DECK,
  });

  // VR hands: chips from the rack, the slot lever.
  for (const g of roulette.grabbables) hands.register(g);
  for (const g of craps.grabbables) hands.register(g);
  for (const b of blackjacks) {
    for (const g of b.grabbables) hands.register(g);
    interaction.register(b.target);
  }
  for (const g of poker.grabbables) hands.register(g);
  for (const tg of poker.targets) interaction.register(tg);
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
    { id: 'poker', label: 'Poker Room', viewpoint: pokerView },
    ...areas.nav,
  ];
  hud.setNav(nav);
  // Tables count as 'at the game' anywhere around them (walk up and play); machines when you stand at one.
  const seatable: { vp: Viewpoint; label: string; center?: THREE.Vector3; reach?: number; ok?: () => boolean }[] = [{ vp: piano.viewpoint, label: 'Play the piano', center: piano.viewpoint.position, reach: 0.95, ok: () => !lounge.pianist?.seated }, { vp: roulette.viewpoint, label: 'Sit at roulette', center: roulette.group.position.clone().add(new THREE.Vector3(0.2, 0, 0.1)), reach: 2.6 }, { vp: craps.viewpoint, label: 'Shoot dice', center: craps.group.position.clone(), reach: 2.9 }, ...machines.map((m) => ({ vp: m.viewpoint, label: `Play ${m.machine.name}` })), { vp: piggy.viewpoint, label: `Play ${piggy.machine.name}` }, ...lounge.seats.map((vp) => ({ vp, label: 'Sit at the bar' })), ...bjSeats.map((s) => ({ vp: s.vp, label: 'Sit at blackjack', center: s.vp.position, reach: 0.85 })), ...pkSeats.map((s) => ({ vp: s.vp, label: 'Sit at poker', center: s.vp.position, reach: 0.75 }))];
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
      if (s.ok && !s.ok()) continue;
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
  const roomBoard = document.getElementById('room-board') as HTMLDivElement;
  let boardKey = '';
  /** The night's scoreboard under the room pill: everyone's chips won or lost tonight, where each friend is, and a Go button. */
  const showBoard = () => {
    const s = session;
    if (!s || !s.friends.length) {
      roomBoard.hidden = true;
      roomBoard.replaceChildren();
      boardKey = '';
      return;
    }
    roomBoard.hidden = false;
    const dirs = new Map(s.friendDirections().map((f) => [f.id, f]));
    const board = s.scoreboard();
    // Only rebuild when something shown changed (so a click on Go never lands mid-rebuild).
    const key = JSON.stringify(board.map((r) => {
      const f = dirs.get(r.id);
      return [r.id, r.name, r.color, r.net, f?.area, f ? Math.round(f.distance) : 0, f?.talking];
    }));
    if (key === boardKey) return;
    boardKey = key;
    const rows = board.map((r) => {
      const row = document.createElement('div');
      row.className = 'row' + (r.me ? ' me' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = Session.css(r.color);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.me ? `${r.name} (you)` : r.name;
      const where = document.createElement('span');
      where.className = 'where';
      const f = dirs.get(r.id);
      where.textContent = f ? `${AREA_NAMES[f.area]} · ${Math.round(f.distance)} m${f.talking ? ' · talking' : ''}` : '';
      const net = document.createElement('span');
      net.className = 'net ' + (r.net > 0 ? 'up' : r.net < 0 ? 'down' : '');
      net.textContent = signedMoney(r.net);
      row.append(dot, name, where, net);
      if (!r.me) {
        const go = document.createElement('button');
        go.textContent = 'Go';
        go.title = `Go to ${r.name}`;
        go.dataset.go = r.id;
        row.append(go);
      } else row.append(document.createElement('span'));
      return row;
    });
    roomBoard.replaceChildren(...rows);
  };
  roomBoard.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go;
    if (!id || !session) return;
    const err = session.goToFriend(id);
    if (err) hud.toast(err, 'warn');
  });
  const showRoom = (friends: string[]) => {
    if (!session) return;
    roomPill.hidden = false;
    showVoice();
    // Who's here is on the scoreboard below: the pill stays short.
    roomPill.textContent = `Room LAGO-${session.code} · ${friends.length ? `${friends.length + 1}/${MAX_PLAYERS}` : 'waiting for friends'} · Chat`;
    roomPill.title = friends.length ? `With ${friends.join(', ')}` : '';
    showBoard();
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
  let looseSync: LooseSync | null = null;
  let liftSync: LiftSync | null = null;
  let photoSync: PhotoSync | null = null;
  let boxing: Boxing | null = null;
  let npcSync: NpcSync | null = null;
  let pianoSync: PianoSync | null = null;
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
      night: () => night.net(),
      where: (p) => areas.where(p),
      ground: {
        free: (x, z, r) => world.isFree(x, z, r),
        inside: (x, z) => world.isInside(x, z),
        water: (x, z) => world.waterAt(x, z) !== null,
        cab: (x, z) => areas.elevators.inCab(x, z),
      },
      liftBusy: () => areas.elevators.riding,
      onAvatar: (i) => {
        me.avatar = i;
        selfBody.setAvatar(i);
        vrMenu.redraw();
      },
    });
    beachBalls.connect(session);
    drinkSync?.dispose();
    drinkSync = new DrinkSync(session, lounge, scene, (c) => drinkPhysics.soaked(c));
    // A friend's camera flash.
    session.on('flash', (_f, d) => {
      const p = d.p as number[];
      if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) photoCams.flash(new THREE.Vector3().fromArray(p));
    });
    looseSync?.dispose();
    looseSync = new LooseSync(session, loose, scene, (at, r, k) => void throwables.wipe(at, r, k));
    // A glass off a waiter's tray: it's gone from her tray for everyone.
    waiterTrays.onTaken = (p) => session?.emit('tray', { u: p.uid });
    session.on('tray', (_f, d) => {
      const w = crowd.people.find((p) => p.role === 'waiter' && p.uid === Number(d.u));
      if (w) waiterTrays.takeRemote(w);
    });
    liftSync?.dispose();
    liftSync = new LiftSync(session, areas.elevators);
    photoSync?.dispose();
    photoSync = new PhotoSync(session, photoCams);
    (window as unknown as { casino: Record<string, unknown> }).casino.photoSync = photoSync;
    party.connect(session);
    bjSync?.dispose();
    bjSync = new BlackjackSync(session, blackjacks);
    (window as unknown as { casino: Record<string, unknown> }).casino.bjSync = bjSync;
    pokerSync?.dispose();
    pokerSync = new PokerSync(session, poker);
    (window as unknown as { casino: Record<string, unknown> }).casino.pokerSync = pokerSync;
    boxing?.dispose();
    boxing = new Boxing({
      session,
      hands,
      player,
      sound,
      hud,
      camera,
      grip: () => gripValues(),
      haptic: (side, strength, ms) => {
        for (const { handedness, gamepad } of interaction.gamepads()) {
          if (handedness !== side) continue;
          (gamepad as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }).hapticActuators?.[0]?.pulse(strength, ms);
        }
      },
    });
    (window as unknown as { casino: Record<string, unknown> }).casino.boxing = boxing;
    pianoSync?.dispose();
    pianoSync = piano ? new PianoSync(session, piano) : null;
    npcSync?.dispose();
    npcSync = new NpcSync({ session, dialogue, crowd, bodies, sound, feet: () => player.feet() });
    (window as unknown as { casino: Record<string, unknown> }).casino.npcSync = npcSync;
    lounge.onLine = (p, l) => npcSync?.share(p, l);
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
    (window as unknown as { casino: Record<string, unknown> }).casino.looseSync = looseSync;
    vrMenu.redraw();
  };
  let me = { name: 'Guest', avatar: 0 };
  let boardT = 0,
    wristT = 0;
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
  // Your watch (left wrist, VR): time, chips, friends; tap it for the menu.
  const watch = new Watch({
    scene,
    camera,
    hands,
    interaction,
    chips: () => bankroll.balance,
    // Bearings from the session: 0 ahead, positive to your right (clockwise, like a watch hand).
    friends: () => (session ? session.friendDirections().map((f) => ({ name: f.name, color: typeof f.color === 'number' ? '#' + f.color.toString(16).padStart(6, '0') : String(f.color), bearing: -f.bearing, distance: f.distance, area: f.area, talking: f.talking })) : []),
    onTap: () => hud.toggleWrist(),
  });
  // Cameras to pick up and take photos with (hands first); K on a screen. Photos go on a board by the bar.
  const boardAt = (() => {
    const f = world.settle(-10.6, 4.4, 0.9);
    return { p: new THREE.Vector3(f ? f[0] : -10.6, 0, f ? f[1] : 4.4), yaw: Math.PI / 2 };
  })();
  world.addBox(boardAt.p.x, boardAt.p.z, 0.3, 1.7, boardAt.yaw);
  const photoCams = new PhotoCams(
    {
      scene,
      renderer,
      camera,
      hands,
      interaction,
      sound,
      inXR: () => player.inXR,
      trigger: (side) => !!interaction.gamepads().find((g) => g.handedness === side)?.gamepad.buttons[0]?.pressed,
      onFlash: (at) => session?.emit('flash', { p: at.toArray().map((v) => Math.round(v * 100) / 100) }),
      toast: (t) => hud.toast(t, 'info'),
      author: () => ({ name: me.name, color: session?.color ?? PLAYER_COLORS[0] }),
    },
    [
      { p: new THREE.Vector3(Lounge.COUNTER_X + 0.3, Lounge.TOP + 0.038, Lounge.COUNTER_Z0 + 0.5), yaw: Math.PI / 2 },
      { p: new THREE.Vector3(POOL_BAR.x + POOL_BAR.r + 0.04, 1.2, POOL_BAR.z + 0.4), yaw: Math.PI / 2 },
    ],
    boardAt,
  );
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || e.repeat || player.inXR || e.target instanceof HTMLInputElement) return;
    const hud0 = document.getElementById('hud');
    const was = hud0?.style.visibility ?? '';
    if (hud0) hud0.style.visibility = 'hidden';
    photoCams.shootView();
    if (hud0) hud0.style.visibility = was;
  });
  // Desktop gallery: your photos, to download.
  {
    const btn = document.createElement('button');
    btn.id = 'photos-btn';
    btn.textContent = 'Photos';
    btn.hidden = true;
    document.querySelector('#hud .actions')?.insertBefore(btn, document.getElementById('help-btn'));
    const panel = document.createElement('div');
    panel.id = 'photos';
    document.body.appendChild(panel);
    const show = () => {
      panel.innerHTML = '<div class="card"><h2>Tonight\'s photos</h2><div class="grid"></div><p class="hint">Click a photo to download it · K takes another</p></div>';
      const grid = panel.querySelector('.grid')!;
      photoCams.photos.forEach((ph, i) => {
        const a = document.createElement('a');
        a.href = ph.url;
        a.download = `palazzo-lago-${new Date(ph.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${i}.jpg`;
        a.innerHTML = `<img src="${ph.url}" alt="photo ${i + 1}">`;
        grid.appendChild(a);
      });
      panel.classList.add('open');
    };
    btn.addEventListener('click', show);
    panel.addEventListener('click', (e) => {
      if (e.target === panel) panel.classList.remove('open');
    });
    photoCams.onPhoto = () => (btn.hidden = false);
  }
  // Touch to press (VR): a pointing index finger presses buttons and menu panels it pushes into.
  interaction.pokers = () => {
    if (!player.inXR) return [];
    const poses = fingerPoses();
    const out: { id: 'left' | 'right'; tip: THREE.Vector3; extended: boolean }[] = [];
    for (const side of ['left', 'right'] as const) {
      const tip = hands.fingertip(side);
      if (tip) out.push({ id: side, tip, extended: poses[side === 'left' ? 'l' : 'r'][1] < 0.45 });
    }
    return out;
  };
  interaction.lasersOn = () => player.comfort.lasers;
  interaction.onPoke = (side) => {
    for (const { handedness, gamepad } of interaction.gamepads()) {
      if (handedness !== side) continue;
      (gamepad as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }).hapticActuators?.[0]?.pulse(0.35, 25);
    }
    sound.playLocal('click', 0.35);
  };
  // VR swimming: your hands' motion drives your strokes (grip positions are in the rig's frame).
  player.strokes = () => {
    if (!player.inXR) return [];
    const t = performance.now() / 1000;
    return hands.hands.filter((h) => h.ctrl.userData.connected !== false && h.grip.visible).map((h) => ({ id: h.index, p: h.grip.position, t }));
  };
  const selfBody = new SelfBody(scene);
  selfBody.root.userData.noLand = true;
  hands.posed.left.root.userData.noLand = true;
  hands.posed.right.root.userData.noLand = true;
  selfBody.onSkin = (c) => hands.setSkin(c);
  selfBody.onDance = (rig, yaw, dt) => party.danceSelf(rig, yaw, dt);
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
      looseSync?.dispose();
      looseSync = null;
      liftSync?.dispose();
      liftSync = null;
      photoSync?.dispose();
      photoSync = null;
      bjSync?.dispose();
      bjSync = null;
      pokerSync?.dispose();
      pokerSync = null;
      drinkSync?.dispose();
      drinkSync = null;
      boxing?.dispose();
      boxing = null;
      npcSync?.dispose();
      npcSync = null;
      pianoSync?.dispose();
      pianoSync = null;
      roomPill.hidden = true;
      roomBoard.hidden = true;
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
    giveCamera: () => {
      if (!photoCams.giveCamera(camera.getWorldPosition(new THREE.Vector3()))) hud.toast('No free camera right now (one is on the bar, one at the pool bar)', 'info');
    },
    voiceReplies: () => listener.enabled,
    toggleVoiceReplies: () => listener.setEnabled(!listener.enabled),
    comfort: () => player.comfort,
    setComfort: (c) => {
      Object.assign(player.comfort, c);
      saveComfort(player.comfort);
    },
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
  // Zone culling: only draw the parts of the resort you could possibly see from here.
  const zoneCulling = (feet: THREE.Vector3) => {
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
      show('skyline', !inSuite);
      show('pool', !inSuite && fx > 16);
      show('hotel', !inSuite && fx > 4);
      show('casino', !inSuite && !onDeck);
      const inCasino = !inSuite && !onDeck;
      for (const o of casinoThings) if (o.visible !== inCasino) o.visible = inCasino;
      // The poker room's furniture, table and lights: only from the west side of the floor (or inside).
      const pokerOn = inCasino && fx < 3;
      if (pokerRoom.interior.visible !== pokerOn) pokerRoom.interior.visible = pokerOn;
    }
  };
  // While an area is being lit in the background the world is mid-change (people hidden, other areas
  // shown), so the game holds: behind the menu the last frame stays up; in the game a quiet dark
  // room with a line of text (head-tracked, so VR stays comfortable).
  let lightingBusy = false;
  let lightTheRest: (() => Promise<void>) | null = null;
  const holdScene = new THREE.Scene();
  holdScene.background = new THREE.Color(0x0b0806);
  const holdCanvas = document.createElement('canvas');
  holdCanvas.width = 1024;
  holdCanvas.height = 128;
  const holdTex = new THREE.CanvasTexture(holdCanvas);
  holdTex.colorSpace = THREE.SRGBColorSpace;
  const holdPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.2), new THREE.MeshBasicMaterial({ map: holdTex, transparent: true, toneMapped: false }));
  holdScene.add(holdPanel);
  const holdText = (t: string) => {
    const g = holdCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 128);
    g.fillStyle = '#e8d3a3';
    g.font = 'italic 52px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, 512, 64);
    holdTex.needsUpdate = true;
  };
  const holdFrame = () => {
    // 2 m ahead of where you look, level.
    const p = camera.getWorldPosition(new THREE.Vector3());
    const d = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    d.normalize();
    holdPanel.position.copy(p).addScaledVector(d, 2);
    holdPanel.lookAt(p.x, holdPanel.position.y, p.z);
    renderer.render(holdScene, camera);
  };
  // Each area's own reflections, captured once behind the loading screen (people and your body hidden).
  {
    const AREA_NAMES: Record<string, string> = { casino: 'the casino floor', hotel: 'the hotel lobby', terrace: 'the terrace and fountains', pool: 'the pool deck', suite: 'the suite' };
    // Only where you start, here; the other areas are lit in the background right after (lightTheRest).
    const startZone = envZoneAt(player.feet());
    loadProgress(0.55, `Step 3 of 3 · Lighting ${AREA_NAMES[startZone] ?? startZone}`);
    try {
      const ms = await casino.captureReflections(zoneCulling, [crowd.group, player.rig, selfBody.root], startZone);
      console.info(`reflections (${startZone}) captured in ${Math.round(ms)} ms`);
    } catch (e) {
      // Keep the generic HDRI reflections rather than fail to open.
      console.warn('reflection capture failed', e);
    }
    const restZones = (['casino', 'hotel', 'terrace', 'pool', 'suite'] as EnvZone[]).filter((z) => z !== startZone);
    lightTheRest = async () => {
      const t0 = performance.now();
      for (const [i, zone] of restZones.entries()) {
        holdText(`Lighting ${AREA_NAMES[zone] ?? zone}… (${i + 1} of ${restZones.length})`);
        lightingBusy = true;
        try {
          await casino.captureReflections(zoneCulling, [crowd.group, player.rig, selfBody.root], zone);
        } catch (e) {
          console.warn('reflection capture failed', zone, e);
        } finally {
          lightingBusy = false;
          zoneCulling(player.feet());
        }
        // Give the game a few frames between areas.
        await new Promise((r) => setTimeout(r, 120));
      }
      const ms = performance.now() - t0;
      (window as unknown as { __envCaptureMs: number }).__envCaptureMs = Math.round(ms);
      console.info(`other areas lit in the background in ${Math.round(ms)} ms`);
    };
    zoneCulling(player.feet());
    loadProgress(1, 'Ready');
    clearInterval(tipTimer);
  }
  renderer.setAnimationLoop(() => {
    timer.update();
    if (lightingBusy) {
      // Behind the menu: keep the last frame. In the game (or VR): the holding room.
      if (enter.classList.contains('done') || renderer.xr.isPresenting) {
        if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
        holdFrame();
      }
      return;
    }
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
    const at = player.seated?.id ?? nearestSeat(player.inXR ? 1.6 : 1.3)?.vp.id ?? (player.inXR && craps.atRail(feet) ? 'craps' : null);
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
    // The room's scoreboard and where everyone is (twice a second on screen; the wrist menu once a second).
    if (session && (boardT -= dt) <= 0) {
      boardT = 0.5;
      showBoard();
      if (player.inXR && (wristT = (wristT + 1) % 2) === 0) vrMenu.redrawRoom();
    }
    drinkSync?.update();
    photoCams.update(dt);
    photoSync?.update(dt);
    watch.update(dt, player.inXR);
    looseSync?.update();
    bjSync?.update(dt);
    pokerSync?.update(dt);
    boxing?.update(dt);
    mirror?.update(dt);
    // Walk up to craps in VR and the stickman slides you the dice.
    if (hud.station === 'craps') craps.standAt(feet);
    if (player.inXR && hud.station === 'craps') craps.offerDice(feet);
    {
      const on = player.inXR;
      hands.showControllers(!on);
      if (on) {
        // Your hands first (they sit on the controllers), then the body's arms reach them.
        hands.poseHands(fingerPoses());
        const head = camera.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
        selfBody.update(dt, { on, head, dir, floorY: player.floorY, hands: { l: hands.wrist('left'), r: hands.wrist('right') }, poses: fingerPoses(), wrists: { l: hands.wristPose('left'), r: hands.wristPose('right') }, speed: player.swimming ? Math.max(player.speed, player.swimSpeed) : player.speed, swim: player.swimming ? 1 : 0, seat: player.stool, eyeY: party.selfEye(head.y), crouch: player.crouch.drop });
      } else selfBody.update(dt, { on: false, head: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), floorY: 0, hands: { l: null, r: null }, poses: { l: [...OPEN] as FingerPose, r: [...OPEN] as FingerPose }, speed: 0 });
    }
    for (const m of machines) m.update(dt);
    piggy.update(dt);
    slotRows.update(t, feet, camera);
    // Blackjack: which seat you're on (sat down, or walked onto the stool), your rack and your hand signals.
    {
      const m = /^bj(\d)s(\d)$/.exec(player.seated?.id ?? '');
      const stool = player.stool;
      blackjacks.forEach((b, i) => {
        let k: number | null = m && Number(m[1]) === i ? Number(m[2]) : null;
        if (k === null && stool) {
          for (let j = 0; j < 7; j++) {
            const sp = b.seatPos(j).pos;
            if (Math.hypot(sp.x - stool.x, sp.z - stool.z) < 0.12) k = j;
          }
        }
        b.setLocal(k);
        b.showRack(player.inXR);
        if (player.inXR && b.mySeat !== null) {
          const poses = fingerPoses();
          for (const side of ['left', 'right'] as const) {
            const h = hands.hands.find((x) => x.ctrl.userData.handedness === side);
            if (!h || h.held || h.ctrl.userData.connected === false) continue;
            const pose = poses[side === 'left' ? 'l' : 'r'];
            const open = 1 - (pose[1] + pose[2] + pose[3] + pose[4]) / 4;
            h.grip.updateMatrixWorld(true);
            const palm = h.grip.visible ? new THREE.Vector3().setFromMatrixPosition(h.grip.matrixWorld) : null;
            b.handInput(side, hands.fingertip(side), palm, open, t);
          }
        }
      });
    }
    for (const b of blackjacks) b.update(dt, feet);
    // Poker: your chair (sat down, or walked onto it), the rack, your hands over the felt.
    {
      const m = /^pk(\d)$/.exec(player.seated?.id ?? '');
      let k: number | null = m ? Number(m[1]) : null;
      const stool = player.stool;
      if (k === null && stool) pokerRoom.seats.forEach((sp, j) => Math.hypot(sp.pos.x - stool.x, sp.pos.z - stool.z) < 0.12 && (k = j));
      poker.setLocal(k);
      poker.showRack(player.inXR);
      if (player.inXR && poker.mySeat !== null) {
        const poses = fingerPoses();
        for (const side of ['left', 'right'] as const) {
          const h = hands.hands.find((x) => x.ctrl.userData.handedness === side);
          if (!h || h.held || h.ctrl.userData.connected === false) continue;
          const pose = poses[side === 'left' ? 'l' : 'r'];
          const open = 1 - (pose[1] + pose[2] + pose[3] + pose[4]) / 4;
          h.grip.updateMatrixWorld(true);
          const palm = h.grip.visible ? new THREE.Vector3().setFromMatrixPosition(h.grip.matrixWorld) : null;
          poker.handInput(side, hands.fingertip(side), palm, open, t);
        }
      }
      poker.update(dt, feet, camera);
      pokerRoom.update(t);
    }
    lounge.update(dt);
    piano?.update(dt);
    pianoSync?.update(dt);
    throwables.update(dt);
    drinkPhysics.update(dt);
    loose.update(dt);
    napkins ??= new Napkins({ loose, throwables, drinkPhysics, sound, crowd, camera, onDab: (p) => (p.attendUntil = Math.min(p.attendUntil, crowd.now + 0.5)) });
    napkins.update(dt);
    // Things you throw that hit someone: a thump, and they let you know about it.
    for (const b of loose.sim.bodies) {
      if (!b.awake || !b.mine || b.held || b.v.lengthSq() < 4) continue;
      const who = drinkPhysics.personAt(b.pos);
      if (!who || hitBy.get(b) === who) continue;
      hitBy.set(b, who);
      sound.play('punch', b.pos, { volume: 0.35, rate: 1.4 });
      who.gaspT = Math.max(who.gaspT, 0.8);
      b.v.multiplyScalar(-0.3);
      reactTo(who, 'hit');
    }
    bodies.update(dt);
    party.update(dt, {
      feet,
      head,
      hands: player.inXR ? { l: hands.wrist('left'), r: hands.wrist('right') } : null,
      xr: player.inXR,
      dancingAllowed: !player.seated && !player.stool && !player.swimming,
    });
    {
      const db = party.deskBob();
      player.danceBob = db.bob;
      player.danceRoll = db.roll;
    }
    crowd.update(dt, t, feet, head);
    faces.update(dt, t, crowd.people, head);
    beachBalls.update(dt);
    casino.update(t, feet);
    areas.update(dt, t, feet);
    swim.update(dt, player.underwater);
    zoneCulling(feet);
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
      const bjAt = station?.startsWith('bj') ? bjSeats.find((s) => s.vp.id === station) : undefined;
      const pkAt = station?.startsWith('pk') ? pkSeats.find((s) => s.vp.id === station) : undefined;
      const pkControls = (): Control[] | null => (poker.mySeat !== null ? poker.controls() : pkAt ? [{ id: 'pksit', label: 'SIT', sub: `poker · buy in ${money(Math.min(1000, bankroll.balance))}`, kind: 'primary', onPress: () => player.sit(pkAt.vp) }] : null);
      const bjControls = (): Control[] | null => {
        const mine = blackjacks.find((b) => b.mySeat !== null);
        if (mine) return mine.controls();
        return bjAt ? [{ id: 'bjsit', label: 'SIT', sub: 'blackjack', kind: 'primary', onPress: () => player.sit(bjAt.vp) }] : null;
      };
      const pianoControls = (): Control[] | null => (player.seated?.id === 'piano' ? piano!.controls() : [{ id: 'psit', label: 'SIT', sub: 'play the piano', kind: 'primary', onPress: () => piano!.sit() }]);
      hud.setControls(station === 'piano' ? pianoControls() : station === 'roulette' ? rouletteControls() : station === 'craps' ? crapsControls() : m ? slotControls(m) : station === piggy.machine.id ? piggyControls(piggy) : bjAt || blackjacks.some((b) => b.mySeat !== null) ? bjControls() : pkAt || poker.mySeat !== null ? pkControls() : null);
      if (lounge.holdingDrink) touch.setAction('Sip', () => lounge.sipHeld());
      else if (loose.holding) touch.setAction('Throw', () => loose.throwDesk());
      else if (player.seated) touch.setAction('Stand', () => player.stand());
      else {
        const s = nearestSeat(1.8);
        touch.setAction(s ? (s.vp.id === 'roulette' || s.vp.id.startsWith('bj') || s.vp.id.startsWith('pk') ? 'Sit' : 'Play') : null, s ? () => player.sit(s.vp) : null);
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
      if (d < 1.4 && now - lastOffer > 45 && !lounge.holdingDrink && w.pause <= 0 && (!w.tray || waiterTrays.glasses(w) > 0)) {
        // She stops and turns to you (waiterTrays turns her, smoothly: the tray stays put on her hand).
        w.pause = 4;
        lastOffer = now;
        hud.toast(player.inXR ? '“Champagne?” Reach out and take a glass from her tray.' : '“Champagne?” Click a glass on her tray to take it.', 'info');
      }
    }
    waiterTrays.update(dt);
    // Outside: the room tone fades and the fountains swell with the show.
    // (Only the lakeside terrace counts here; the pool deck has its own party.)
    const outside = Math.abs(feet.x) < 14 ? THREE.MathUtils.clamp((-14 - feet.z) / 2, 0, 1) : 0;
    sound.setAmbience(1 - outside * 0.75);
    // Music: lively on the floor, softer by the piano and outside.
    const byPiano = THREE.MathUtils.clamp(1 - feet.distanceTo(lounge.piano.position) / 7, 0, 1);
    // Out at the pool party the DJ takes over: the casino's groove ducks out.
    sound.setMusicLevel(0.2 * (1 - outside * 0.6) * (1 - byPiano * 0.8) * (1 - 0.95 * party.presence));
    if (outside > 0.5) {
      if (!finaleSeen && casino.fountainLevel() > 0.8) {
        finaleSeen = true;
        night.complete('finale');
        crew.react('finale', { force: true, cheer: true });
      } else if (Math.random() < 0.002) crew.react('terrace', { chance: 0.6 });
    }
    // The fountains are for out on the terrace: inside you barely hear them (a whisper through open doors).
    fountainVoice.setVolume((0.2 + casino.fountainLevel() * 0.75) * (outside + (1 - outside) * casino.doorsOpen() * 0.03));

    // Count the whole frame (all post passes), not just the last one.
    renderer.info.autoReset = false;
    renderer.info.reset();
    post.render(scene, camera);
    if (first) {
      first = false;
      if (lightTheRest) setTimeout(() => void lightTheRest?.(), 0);
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

  const colliders = new ColliderDebug(scene, world, renderer, [crowd.group, selfBody.root, player.rig]);
  (window as unknown as { casino: unknown }).casino = { piano, Drink, waiterTrays, napkins: () => napkins, hall: casino, zoneCulling, party, renderPartyTrack, colliders, scene, renderer, player, areas, roulette, craps, machines, piggy, bankroll, hud, quality, crowd, world, lounge, hands, interaction, crew, night, touch, sound, POSE, FINGER, THUMB, curlFingers, setFingers, dialogue, selfBody, voices, throwables, makeMouth, setOpen, bodies, drinkPhysics, loose, beachBalls, slotRows, blackjacks, watch, faces, bjSeats, camera, photoCams, poker, pokerRoom, pkSeats };
}

main().catch((e) => {
  console.error(e);
  document.getElementById('loading')!.textContent = 'Something went wrong starting the casino. ' + String(e);
});
