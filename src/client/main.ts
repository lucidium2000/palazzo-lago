import * as THREE from 'three';
import { Bankroll, type BankrollState } from '../rules/bankroll';
import { DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY } from '../rules/machines';
import { CryptoRng } from '../rules/rng';
import { Sound } from './audio';
import { buildCasino, POSITIONS, SLOTS_YAW } from './casino';
import { preloadChips } from './chips';
import { buildCrapsPreview } from './craps';
import { money, type GameContext } from './game';
import { Hud, type NavItem } from './hud';
import { Interaction } from './interaction';
import { Player, type Viewpoint } from './player';
import { detectTier } from './quality';
import { RouletteTable } from './roulette/table';
import { SlotMachineView } from './slots/machine';

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
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.03, 260);
  const player = new Player(camera, renderer);
  scene.add(player.rig);
  const interaction = new Interaction(renderer.domElement, camera, renderer, player.rig);
  player.attach(interaction);

  const casino = buildCasino(scene, renderer, quality);
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

  // --- Stations ---------------------------------------------------------------
  const roulette = new RouletteTable(ctx, POSITIONS.roulette);
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
    return new SlotMachineView(ctx, m, pos, yaw, themes[i]);
  });
  buildCrapsPreview(ctx, POSITIONS.craps);

  // Blockers so floor teleports don't go through furniture.
  interaction.register({ object: roulette.group, kind: 'surface' });
  for (const m of machines) interaction.register({ object: m.group, kind: 'surface' });

  // Teleport / walk by selecting the floor.
  interaction.register({
    object: casino.floor,
    kind: 'floor',
    onSelect: (e) => player.teleportTo(e.hit.point),
  });

  const lobby: Viewpoint = { id: 'lobby', label: 'Lobby', position: POSITIONS.start.clone(), yaw: -0.08, pitch: -0.04, eye: 1.6 };
  const slotsOverview: Viewpoint = {
    id: 'slots',
    label: 'Slots',
    position: POSITIONS.slots.clone().add(new THREE.Vector3(Math.sin(SLOTS_YAW), 0, Math.cos(SLOTS_YAW)).multiplyScalar(2.6)),
    yaw: SLOTS_YAW,
    pitch: -0.08,
    eye: 1.6,
  };
  const nav: NavItem[] = [
    { id: 'lobby', label: 'Lobby', viewpoint: lobby },
    { id: 'roulette', label: 'Roulette', viewpoint: roulette.viewpoint },
    { id: 'slots', label: 'Slots', viewpoint: slotsOverview },
    ...machines.map((m) => ({ id: m.machine.id, label: m.machine.name, viewpoint: m.viewpoint })),
    { id: 'craps', label: 'Craps', disabled: 'Opening soon' },
  ];
  hud.setNav(nav);
  hud.onNavigate = (item) => {
    if (item.viewpoint) player.travel(item.viewpoint);
  };
  player.onArrive = (v) => hud.setStation(v.id);
  player.place(lobby);

  // --- Welcome and daily top-up -----------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const bonus = bankroll.claimDailyBonus(today);
  setTimeout(() => {
    hud.toast(bonus ? `Welcome to Palazzo Lago · daily bonus ${money(bonus)}` : 'Welcome back to Palazzo Lago', 'win');
  }, 900);
  document.getElementById('reset')!.addEventListener('click', () => {
    if (bankroll.balance < 100 || confirm('Reset your chips to $10,000?')) {
      bankroll.reset();
      hud.toast(`Chips reset to ${money(bankroll.balance)}`);
    }
  });

  // --- Sound toggle, help ---------------------------------------------------------
  const soundBtn = document.getElementById('sound')!;
  soundBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    soundBtn.textContent = sound.muted ? 'Sound off' : 'Sound on';
  });
  const help = document.getElementById('help')!;
  document.getElementById('help-btn')!.addEventListener('click', () => help.classList.toggle('open'));
  help.addEventListener('click', () => help.classList.remove('open'));

  // --- VR -------------------------------------------------------------------
  const vrBtn = document.getElementById('vr') as HTMLButtonElement;
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (xr && (await xr.isSessionSupported('immersive-vr').catch(() => false))) {
    vrBtn.hidden = false;
    let session: XRSession | null = null;
    vrBtn.addEventListener('click', async () => {
      if (session) return session.end();
      session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      session.addEventListener('end', () => {
        session = null;
        vrBtn.textContent = 'Enter VR';
        if (player.current) player.place(player.current);
      });
      await renderer.xr.setSession(session);
      vrBtn.textContent = 'Exit VR';
      // Head pose is known after the first XR frame; then put the player at their spot.
      const where = player.current ?? lobby;
      setTimeout(() => player.place(where), 120);
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
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    interaction.update();
    player.update(dt, interaction);
    if ((player.current?.id ?? null) !== hud.station) hud.setStation(player.current?.id ?? null);
    roulette.update(dt);
    for (const m of machines) m.update(dt);
    casino.update(t);
    hud.update(camera);
    renderer.render(scene, camera);
    if (first) {
      first = false;
      document.getElementById('loading')!.classList.add('done');
    }
    if (stats) {
      frames++;
      const now = performance.now();
      if (now - since > 500) {
        const info = renderer.info.render;
        stats.textContent = `${quality.label} · ${Math.round((frames * 1000) / (now - since))} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris`;
        frames = 0;
        since = now;
      }
    }
  });

  (window as unknown as { casino: unknown }).casino = { scene, renderer, player, roulette, machines, bankroll, hud, quality };
}

main().catch((e) => {
  console.error(e);
  document.getElementById('loading')!.textContent = 'Something went wrong starting the casino. ' + String(e);
});
