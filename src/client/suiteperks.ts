import * as THREE from 'three';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Interaction } from './interaction';
import type { Drink, Lounge } from './lounge';
import { BOTTLES } from './loose';
import { DRINKS } from './bar';
import { canvas, toTexture } from './textures';
import { GOLD, GOLD_LIGHT, SERIF } from './panel';

/**
 * The suite's and the lifts' perks:
 *  - a speaker on the bedside table: touch it to play the resort's music in
 *    your room (the lounge set, Orlo Vante's two songs, the pool DJ's set),
 *    touch again for the next, round to off; the casino's music steps aside;
 *  - soft lounge music in the lift cars while you ride;
 *  - a minibar to mix your own: real bottles to pour (loose.ts), empty
 *    glasses, and a card of house recipes on the wall. Pour a recipe into a
 *    glass and the room calls it ("You mixed a Vesper Martini").
 */

/** The tracks the speaker plays, in order (public/audio, ElevenLabs Music). */
const TRACKS: { file: string; label: string }[] = [
  { file: 'casino_lounge', label: 'Lounge set' },
  { file: 'orlo_neon_on_the_water', label: 'Orlo Vante · Neon on the Water' },
  { file: 'orlo_last_call_heart', label: 'Orlo Vante · Last Call Heart' },
  { file: 'dj_set', label: 'Pool party DJ set' },
];

/** House recipes: the spirits that must be in the glass (each at least a fair share). */
export const RECIPES: { name: string; spirits: (keyof typeof BOTTLES)[]; card: string }[] = [
  { name: 'Vesper Martini', spirits: ['gin', 'vodka'], card: 'gin + vodka' },
  { name: 'French 75', spirits: ['gin', 'champagne'], card: 'gin + champagne' },
  { name: 'Tequila Royale', spirits: ['tequila', 'champagne'], card: 'tequila + champagne' },
  { name: "Pirate's Grog", spirits: ['rum', 'whisky'], card: 'rum + whisky' },
  { name: 'Sparkling Sangria', spirits: ['wine', 'champagne'], card: 'red wine + champagne' },
  { name: 'Long Island Iced Tea', spirits: ['vodka', 'gin', 'rum', 'tequila'], card: 'vodka + gin + rum + tequila' },
];

/** Which recipe a glass holds, from what was poured into it (by each bottle's liquid colour), or null. */
export function recipeFor(poured: ReadonlyMap<number, number>): string | null {
  const total = [...poured.values()].reduce((a, b) => a + b, 0);
  if (total < 0.15) return null;
  const share = (name: keyof typeof BOTTLES) => (poured.get(BOTTLES[name].liquid) ?? 0) / total;
  // Most spirits first, so the Long Island wins over a Vesper inside it.
  for (const r of [...RECIPES].sort((a, b) => b.spirits.length - a.spirits.length)) {
    const min = 0.6 / r.spirits.length;
    if (r.spirits.every((s) => share(s) >= min)) return r.name;
  }
  return null;
}

export interface SuitePerksDeps {
  scene: THREE.Scene;
  sound: Sound;
  hud: Hud;
  interaction: Interaction;
  lounge: Lounge;
  /** Where you are (your feet), and whether you're in a lift car there. */
  feet(): THREE.Vector3;
  inLift(x: number, z: number): boolean;
}

export class SuitePerks {
  private speaker: THREE.Group;
  private audio: THREE.PositionalAudio;
  private liftAudio: THREE.Audio;
  private track = -1;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private glasses: Drink[] = [];
  private called = new Map<Drink, string>();
  private checkT = 0;
  private liftLevel = 0;
  /** How far the casino's own music should step aside (0..1): your room's speaker or the lift's music is on. */
  duck = 0;

  constructor(private d: SuitePerksDeps) {
    // The speaker: a small fabric-wrapped cylinder with a glowing ring, on the right-hand nightstand.
    this.speaker = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.9 }));
    body.position.y = 0.1;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 24), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.5 }));
    top.position.y = 0.205;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffc870, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.212;
    this.speaker.add(body, top, ring);
    this.speaker.position.set(594.88, 0.6, 4.74);
    d.scene.add(this.speaker);
    this.audio = new THREE.PositionalAudio(d.sound.listener);
    this.audio.setRefDistance(2.5);
    this.audio.setRolloffFactor(1.2);
    this.audio.setLoop(true);
    this.speaker.add(this.audio);
    d.interaction.register({
      object: this.speaker,
      kind: 'button',
      pokeable: true,
      label: () => (this.track < 0 ? 'Speaker · play music' : this.track < TRACKS.length - 1 ? `Speaker · next: ${TRACKS[this.track + 1].label}` : 'Speaker · off'),
      onSelect: () => this.next(),
    });
    // Lift music: quiet and everywhere in the car (not positional).
    this.liftAudio = new THREE.Audio(d.sound.listener);
    this.liftAudio.setLoop(true);
    this.liftAudio.setVolume(0);
    // The minibar: three empty glasses to mix in, and the house recipes on the wall above.
    const kinds = ['Dry Martini', 'Scotch on the rocks', 'Champagne'].map((n) => DRINKS.find((k) => k.name === n)!);
    kinds.forEach((k, i) => this.glasses.push(d.lounge.placeGlass(k, new THREE.Vector3(597.9 + i * 0.26, 0.985, -5.08), `suite-mix-${i}`)));
    d.scene.add(this.recipeCard());
  }

  /** The next track on the speaker (round to off). */
  private next() {
    this.track = this.track + 1 >= TRACKS.length ? -1 : this.track + 1;
    this.d.sound.play('click', this.speaker, { volume: 0.6 });
    if (this.audio.isPlaying) this.audio.stop();
    if (this.track < 0) {
      this.d.hud.toast('Speaker off', 'info');
      return;
    }
    const t = TRACKS[this.track];
    const want = this.track;
    this.d.hud.toast(`Now playing: ${t.label}`, 'info');
    void this.load(t.file).then((buf) => {
      if (!buf || this.track !== want) return;
      this.audio.setBuffer(buf);
      this.audio.play();
    });
  }

  private load(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = new THREE.AudioLoader()
        .loadAsync(new URL(`audio/${file}.mp3`, document.baseURI).href)
        .catch(() => null);
      this.buffers.set(file, p);
    }
    return p;
  }

  /** A framed card of house recipes over the minibar. */
  private recipeCard(): THREE.Mesh {
    const [c, g] = canvas(640, 400);
    g.fillStyle = '#120c08';
    g.fillRect(0, 0, 640, 400);
    g.strokeStyle = GOLD;
    g.lineWidth = 8;
    g.strokeRect(10, 10, 620, 380);
    g.fillStyle = GOLD_LIGHT;
    g.textAlign = 'center';
    g.font = `italic 600 40px ${SERIF}`;
    g.fillText('Mix your own', 320, 62);
    g.font = `22px ${SERIF}`;
    g.fillStyle = '#cbb991';
    g.fillText('Tip a bottle over a glass to pour; pour two or more to mix', 320, 96);
    RECIPES.forEach((r, i) => {
      const y = 140 + i * 42;
      g.textAlign = 'left';
      g.fillStyle = '#f3dc9a';
      g.font = `600 26px ${SERIF}`;
      g.fillText(r.name, 40, y);
      g.textAlign = 'right';
      g.fillStyle = '#efe3c6';
      g.font = `italic 24px ${SERIF}`;
      g.fillText(r.card, 600, y);
    });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.6), new THREE.MeshBasicMaterial({ map: toTexture(c), toneMapped: false }));
    card.position.set(598.5, 2.05, -5.97);
    return card;
  }

  update(dt: number) {
    const f = this.d.feet();
    const inSuite = f.x > 500;
    // The speaker only plays to the room it's in.
    if (this.audio.isPlaying) this.audio.setVolume(this.d.sound.muted || !this.d.sound.musicOn ? 0 : inSuite ? 0.9 : 0);
    // Lift music fades in as you step into a car and out as you leave.
    const inLift = this.d.inLift(f.x, f.z);
    this.liftLevel += ((inLift ? 1 : 0) - this.liftLevel) * Math.min(1, dt * 1.5);
    if (inLift && !this.liftAudio.buffer) {
      void this.load('casino_lounge').then((buf) => {
        if (buf && !this.liftAudio.buffer) {
          this.liftAudio.setBuffer(buf);
          this.liftAudio.play();
        }
      });
    }
    if (this.liftAudio.buffer) this.liftAudio.setVolume(this.d.sound.muted || !this.d.sound.musicOn ? 0 : 0.22 * this.liftLevel);
    this.duck = Math.max(inSuite && this.audio.isPlaying ? 1 : 0, this.liftLevel);
    // Every half second: has anyone mixed a house recipe in one of the minibar's glasses?
    if ((this.checkT -= dt) > 0 || !inSuite) return;
    this.checkT = 0.5;
    for (const g of this.glasses) {
      const name = recipeFor(g.poured);
      if (name && this.called.get(g) !== name) {
        this.called.set(g, name);
        this.d.hud.toast(`You mixed a ${name} 🍸`, 'win');
        this.d.sound.play('ding', g.group.getWorldPosition(new THREE.Vector3()), { volume: 0.5 });
      }
    }
  }
}
