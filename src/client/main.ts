import * as THREE from 'three';
import { Bankroll, type BankrollState } from '../rules/bankroll';
import { DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY } from '../rules/machines';
import { pocketColor, pocketLabel } from '../rules/roulette';
import { CryptoRng } from '../rules/rng';
import { Sound } from './audio';
import { buildCasino, POSITIONS, registerHall, SLOTS_YAW } from './casino';
import { preloadChips } from './chips';
import { buildCrapsPreview } from './craps';
import { SlotRows } from './decor';
import { money, type GameContext } from './game';
import { Hands } from './hands';
import { Hud, type NavItem } from './hud';
import { Interaction } from './interaction';
import { Lounge } from './lounge';
import { Crowd, randomLook, staffLook, type Person } from './people';
import { Player, type Viewpoint } from './player';
import { detectTier } from './quality';
import { WHEEL_CENTER } from './roulette/layout';
import { RouletteTable } from './roulette/table';
import { SlotMachineView } from './slots/machine';
import { World } from './world';

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
  renderer.toneMappingExposure = 1.05;
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
  const sound = new Sound(scene, camera);
  const bankroll = loadBankroll();
  let saveTimer = 0;
  bankroll.onChange(() => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveBankroll(bankroll), 400);
  });
  const hud = new Hud(bankroll, scene, renderer, interaction);
  preloadChips();

  const ctx: GameContext = { scene, interaction, sound, bankroll, hud, rng: new CryptoRng(), quality };
  const crowd = new Crowd(scene, quality, world);

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
  const craps = buildCrapsPreview(ctx, POSITIONS.craps);
  world.addLocalBox(craps, 0, 0, 3.9, 1.8);
  world.addLocalBox(craps, 0, 1.5, 5.4, 0.3);

  // --- Places and people -------------------------------------------------------------
  const lounge = new Lounge({ ...ctx, crowd, hands, player, world });
  const slotRows = new SlotRows(ctx, crowd, world);

  // Walking routes through the open floor; edges are found automatically.
  crowd.setGraph([
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
  for (const w of spots.watchers) {
    const p = crowd.add(w.seated ? 'patron' : 'watch', randomLook(), w.pos, w.yaw);
    if (p && w.seated) p.seatY = 0.68;
  }
  const near = (p: THREE.Vector3, r: number) => player.feet().distanceTo(p) < r;
  let placeBetsTimer = 0;
  roulette.onSpin = () => {
    if (croupier) {
      croupier.actionKind = 'reach';
      croupier.action = 1.2;
    }
    if (near(roulette.group.position, 5)) sound.say('No more bets.');
  };
  roulette.onResult = (pocket, staked, returned) => {
    const call = `${pocketLabel(pocket) === '00' ? 'Double zero' : pocketLabel(pocket)}${pocketColor(pocket) === 'green' ? '' : ', ' + pocketColor(pocket)}.`;
    if (near(roulette.group.position, 6)) sound.say(call);
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
  // Guests wandering the floor fill the rest of the crowd.
  const wanderers = crowd.capacity - crowd.people.length - 1;
  for (let i = 0; i < wanderers; i++) crowd.add('wander', randomLook(), crowd.randomNode());

  // VR hands: chips from the rack, the slot lever.
  for (const g of roulette.grabbables) hands.register(g);
  const lever = machines[0].leverGrab();
  if (lever) hands.register(lever);

  // Teleport / walk by selecting the floor.
  interaction.register({ object: roulette.group, kind: 'surface' });
  for (const m of machines) interaction.register({ object: m.group, kind: 'surface' });
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
    { id: 'bar', label: 'Bar Lago', viewpoint: bar },
    { id: 'terrace', label: 'Terrace', viewpoint: terrace },
    { id: 'craps', label: 'Craps', disabled: 'Opening soon' },
  ];
  hud.setNav(nav);
  const seatable = [{ vp: roulette.viewpoint, label: 'Sit at roulette' }, ...machines.map((m) => ({ vp: m.viewpoint, label: `Play ${m.machine.name}` }))];
  hud.onNavigate = (item) => {
    if (!item.viewpoint) return;
    const seat = seatable.find((s) => s.vp === item.viewpoint);
    if (seat && !player.inXR) player.sit(seat.vp);
    else {
      if (player.seated) player.stand();
      player.travel(item.viewpoint);
    }
  };
  player.place(lobby);
  player.current = null;

  /** The game you are at: the one you are sitting at, or one you are standing close to. */
  const nearestSeat = (r: number) => {
    const f = player.feet();
    let best: (typeof seatable)[number] | null = null,
      bd = r;
    for (const s of seatable) {
      const d = s.vp.position.distanceTo(f);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  // --- Keyboard, entry screen, map --------------------------------------------------
  const enter = document.getElementById('enter')!;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const stepInside = () => {
    enter.classList.add('done');
    player.lockPointer();
  };
  document.getElementById('enter-btn')!.addEventListener('click', stepInside);
  if (isTouch) enter.classList.add('done');
  renderer.domElement.addEventListener('click', () => {
    // Clicking the room in free-cursor mode while standing re-captures the mouse.
    if (!player.seated && !player.pointerLocked && !player.inXR && enter.classList.contains('done') && !interaction.hoverLabel()) player.lockPointer();
  });
  const mapBtn = document.getElementById('map-btn')!;
  mapBtn.addEventListener('click', () => hud.toggleMap());
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') hud.toggleMap();
    if (e.code === 'KeyE' && !player.inXR) {
      if (player.seated) {
        player.stand();
        player.lockPointer();
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
  const soundBtn = document.getElementById('sound')!;
  soundBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    soundBtn.textContent = sound.muted ? 'Sound off' : 'Sound on';
  });
  const help = document.getElementById('help')!;
  document.getElementById('help-btn')!.addEventListener('click', () => help.classList.toggle('open'));
  help.addEventListener('click', () => help.classList.remove('open'));
  player.onStep = (surface, run) => {
    const name = surface === 'carpet' ? 'stepCarpet' : surface === 'stone' ? 'stepStone' : 'stepMarble';
    sound.playLocal(name, (surface === 'carpet' ? 0.45 : 0.3) * (run ? 1.2 : 1), 0.9 + Math.random() * 0.2);
  };
  const fountainVoice = sound.ambientAt('water', casino.fountainAnchor, { volume: 0.6, ref: 30, rolloff: 0.9 });

  // --- VR -------------------------------------------------------------------
  const vrBtn = document.getElementById('vr') as HTMLButtonElement;
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (xr && (await xr.isSessionSupported('immersive-vr').catch(() => false))) {
    vrBtn.hidden = false;
    let session: XRSession | null = null;
    vrBtn.addEventListener('click', async () => {
      if (session) return session.end();
      enter.classList.add('done');
      session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      session.addEventListener('end', () => {
        session = null;
        vrBtn.textContent = 'Enter VR';
      });
      await renderer.xr.setSession(session);
      vrBtn.textContent = 'Exit VR';
      // Head pose is known after the first XR frame; then put the player where they were.
      const where: Viewpoint = { ...lobby, position: player.feet(), yaw: player.rig.rotation.y };
      setTimeout(() => {
        player.place(where);
        player.current = null;
      }, 120);
    });
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // --- Frame loop --------------------------------------------------------------
  const timer = new THREE.Timer();
  const stats = new URLSearchParams(location.search).has('stats') ? document.getElementById('stats') : null;
  let frames = 0,
    since = performance.now();
  let first = true;
  const head = new THREE.Vector3();
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
    for (const m of machines) m.update(dt);
    slotRows.update(t, feet);
    lounge.update(dt);
    crowd.update(dt, t, feet, head);
    casino.update(t, feet);
    hud.update(camera);

    // Croupier invites bets again after each spin.
    if (placeBetsTimer > 0) {
      placeBetsTimer -= dt;
      if (placeBetsTimer <= 0 && near(roulette.group.position, 5)) sound.say('Place your bets, please.');
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
    const outside = THREE.MathUtils.clamp((-14 - feet.z) / 2, 0, 1);
    const doorway = Math.max(outside, casino.doorsOpen() * 0.4);
    sound.setAmbience(1 - outside * 0.75);
    fountainVoice.setVolume((0.25 + casino.fountainLevel() * 0.9) * (0.25 + doorway * 0.75));

    renderer.render(scene, camera);
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

  (window as unknown as { casino: unknown }).casino = { scene, renderer, player, roulette, machines, bankroll, hud, quality, crowd, world, lounge, hands, interaction };
}

main().catch((e) => {
  console.error(e);
  document.getElementById('loading')!.textContent = 'Something went wrong starting the casino. ' + String(e);
});
