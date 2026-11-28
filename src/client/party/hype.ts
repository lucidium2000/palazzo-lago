import * as THREE from 'three';
import type { Sound } from '../audio';
import type { Crowd, Person } from '../people';
import { STAGE } from '../areas/pool';
import type { Audience } from './audience';
import { BackCrowd, backCount } from './backcrowd';
import type { Beat } from './beat';
import type { PartyPhase } from './concertlines';
import { onStage, phaseAt } from './partytalk';

/**
 * The concert's hype: what makes her set feel like a real show around you.
 *
 * - The crowd's sound, from the audience in front of her stage (positional):
 *   a cheer as the DJ calls her ("in one minute": called()), then
 *   a murmuring bed that swells as her set gets close and with the song's
 *   energy; the crowd clapping together on the beat in the build-ups (and the
 *   last bars before she walks on, with a "hey!" on each bar); wordless
 *   whoops from men and women all through it, thicker in the choruses; a roar
 *   as she walks on, as a song ends, and as her set does (crowdsfx.ts).
 * - The crowd's bodies: hands up in the choruses, phones up filming her
 *   (people.ts draws the phone, dance.ts holds it up), and dozens more fans
 *   filling the deck behind them (backcrowd.ts).
 * - Who may talk: she's hushed from her walk-on to the end of her set, the
 *   band and the DJ always (partytalk.ts); the night's moment (`phase`) for
 *   everyone else's chatter.
 *
 * Driven by the party's beat clock and the shared running order, so a room
 * hears and sees the same show.
 */

/** Where the crowd's sound comes from: the middle of her audience, head height. */
const CROWD_AT = new THREE.Vector3(STAGE.spot.x, 1.6, STAGE.z1 + 3.2);
/** At most this many whoops at once (they share the effects' voices with everything else). */
const MAX_WHOOPS = 4;

export interface HypeDeps {
  scene: THREE.Scene;
  sound: Sound;
  crowd: Crowd;
  audience: Audience | null;
  singer: Person | null;
  band: (Person | null)[];
  dj: Person | null;
  isFree?: (x: number, z: number) => boolean;
}

export interface HypeUpdate {
  beat: Beat;
  onBeat: boolean;
  onBar: boolean;
  /** Her music is loaded, her set is on (and which song, -1 between), seconds until her next set, one bar (s). */
  ready: boolean;
  live: boolean;
  song: number;
  into: number;
  toLive: number;
  bar: number;
  /** The DJ's called her for this set ("in one minute"): the crowd's on "one minute!" now. */
  called?: boolean;
  /** 0..1: how much you're out at the party. */
  presence: number;
  /** Your feet (people step aside for you). */
  you: THREE.Vector3;
}

export class ConcertHype {
  /** Where the night is (partytalk.ts): the crowd's chatter follows it. */
  phase: PartyPhase = 'dj';
  /** 0..1: how hard the crowd's going. */
  energy = 0;
  readonly back: BackCrowd | null;
  private bed: THREE.PositionalAudio | null = null;
  private bedAnchor = new THREE.Object3D();
  private stage = false;
  private wasLive = false;
  private prevPart = '';
  private prevSong = -1;
  private endedAt = -Infinity;
  private time = 0;
  private whoopIn = 1;
  private whoops: number[] = [];
  private cheerIn = 0;
  private filmers = new Map<Person, Person['prop']>();
  private avoid: { x: number; z: number }[] = [];
  private v = new THREE.Vector3();
  /** What the crowd's done (for the curious: window.casino.party.hype). */
  readonly log: string[] = [];

  constructor(private d: HypeDeps) {
    this.bedAnchor.position.copy(CROWD_AT);
    this.bedAnchor.name = 'concert-crowd';
    d.scene.add(this.bedAnchor);
    this.back = d.isFree ? new BackCrowd(d.scene, backCount(d.crowd.tierPeople), d.isFree) : null;
    // The DJ and the band are always at work.
    for (const p of [d.dj, ...d.band]) if (p) p.hush = true;
  }

  private note(what: string) {
    this.log.push(what);
    if (this.log.length > 24) this.log.shift();
  }

  /** A sound from the crowd, near `at` (or its middle). */
  private crowdSound(name: Parameters<Sound['play']>[0], volume: number, at?: THREE.Vector3, rate = 1) {
    return this.d.sound.play(name, (at ?? CROWD_AT).clone(), { volume, ref: 6, rolloff: 1, rate });
  }

  /** One person in the crowd whoops (a woman's or a man's voice), from where they stand. */
  whoop(at: THREE.Vector3 | null, female: boolean, volume = 0.5) {
    const now = this.time;
    this.whoops = this.whoops.filter((t) => t > now);
    if (this.whoops.length >= MAX_WHOOPS) return false;
    const a = this.crowdSound(female ? 'whooF' : 'whooM', volume, at ?? undefined, 0.92 + Math.random() * 0.16);
    if (!a) return false;
    this.whoops.push(now + 0.9);
    return true;
  }

  /** A burst of whoops and hands up all over the crowd (she walks on, a chorus lands, a song ends). */
  private burst(n: number, volume: number) {
    for (let k = 0; k < n; k++) setTimeout(() => this.randomWhoop(volume), k * (90 + Math.random() * 160));
    this.d.crowd.react(CROWD_AT, 9, 'cheer');
  }

  private randomWhoop(volume: number) {
    const fan = this.back?.someone(Math.random());
    const p = this.audiencePerson();
    const useFan = fan && (!p || Math.random() < 0.6);
    if (useFan) return this.whoop(this.v.set(fan.x, 1.65, fan.z), fan.female, volume);
    if (p) return this.whoop(this.v.copy(p.pos).setY(p.pos.y + 1.65), (p.look.kind ?? '').startsWith('female') || p.look.dress, volume);
    return this.whoop(null, Math.random() < 0.5, volume);
  }

  private audiencePerson(): Person | null {
    const ps = this.d.audience?.people.filter((p) => !p.away) ?? [];
    return ps.length ? ps[Math.floor(Math.random() * ps.length)] : null;
  }

  /** The DJ's just called her ("in one minute"): a cheer, whoops and hands up all over. */
  called(here: boolean) {
    this.energy = Math.max(this.energy, 0.6);
    if (!here) return;
    this.crowdSound('crowdRoar', 0.75);
    this.burst(9, 0.5);
    this.note('called');
  }

  update(dt: number, o: HypeUpdate) {
    this.time += dt;
    const b = o.beat;
    // She's hushed from her walk-on to the end of her set.
    this.stage = onStage({ ready: o.ready, live: o.live, toLive: o.toLive, bar: o.bar });
    if (this.d.singer) this.d.singer.hush = this.stage;
    if (this.wasLive && !o.live) this.endedAt = this.time;
    const since = this.time - this.endedAt;
    this.phase = phaseAt({ live: o.live, song: o.song, toLive: o.toLive, sinceEnd: since, called: o.called });

    // How hard the crowd's going.
    let want: number;
    if (o.live) want = o.song >= 0 ? 0.35 + 0.6 * b.intensity + (b.part === 'chorus' ? 0.15 : 0) : 0.55;
    else if (this.stage) want = 0.85;
    else if (this.phase === 'after') want = 0.5 * Math.exp(-since / 20);
    else if (this.phase === 'soon') want = 0.3 + 0.4 * THREE.MathUtils.clamp(1 - o.toLive / 75, 0, 1);
    else want = 0.1;
    want = Math.min(1, want);
    this.energy += (want - this.energy) * Math.min(1, dt * (want > this.energy ? 2 : 0.5));

    // The bed: the crowd murmuring, louder with the energy (only out at the party).
    const here = o.presence > 0.05;
    if (!this.bed && here) this.bed = this.d.sound.ambientAt('crowdBed', this.bedAnchor, { volume: 0, ref: 7, rolloff: 1 });
    if (this.bed) {
      const ctx = this.d.sound.listener.context;
      this.bed.gain.gain.setTargetAtTime((0.05 + 0.4 * this.energy) * Math.min(1, o.presence * 1.5), ctx.currentTime, 0.25);
    }

    // The big moments: she walks on, a song's music ends, her set's over.
    const walkOn = this.stage && !this.prevStage;
    if (walkOn && here) {
      this.crowdSound('crowdRoar', 1);
      this.burst(10, 0.55);
      this.note('walk-on');
    }
    if (o.live && b.part === 'outro' && this.prevPart !== 'outro' && here) {
      this.crowdSound('crowdRoar', 0.85);
      this.burst(6, 0.5);
      this.note('song-end');
    }
    if (o.live && o.song !== this.prevSong && this.prevSong >= 0 && here) {
      this.crowdSound('crowdRoar', 0.8);
      this.note('next-song');
    }
    if (this.wasLive && !o.live && here) {
      this.crowdSound('crowdRoar', 1);
      this.burst(8, 0.55);
      this.note('set-end');
    }
    // A chorus lands: whoops and hands up.
    const chorus = o.live && b.part === 'chorus';
    if (chorus && this.prevPart !== 'chorus' && here) {
      this.burst(5, 0.45);
      this.note('chorus');
    }

    // Clapping along: the build-ups (every beat), the quieter parts (2 and 4), and the last bars before she's on (every beat, "hey!" each bar).
    const pre = !o.live && o.ready && o.toLive > 0 && o.toLive < 8 * o.bar;
    const build = o.live && (b.part === 'pre-chorus' || b.section === 'build');
    const backbeat = o.live && (b.part === 'bridge' || b.part === 'intro') && b.intensity < 0.7;
    const clap = pre || build || backbeat;
    if (o.onBeat && here && (pre || build || (backbeat && b.beatInBar % 2 === 1))) {
      const v = pre ? 0.5 : 0.42;
      this.crowdSound('crowdClap', v, this.v.copy(CROWD_AT).setX(CROWD_AT.x - 1.6));
      this.crowdSound('crowdClap', v * 0.85, this.v.copy(CROWD_AT).setX(CROWD_AT.x + 1.6));
      if (pre && b.beatInBar === 3) this.crowdSound('crowdHey', 0.55);
    }

    // Whoops all through it: more as the energy rises (a few even during the DJ's stretch).
    this.whoopIn -= dt;
    if (this.whoopIn <= 0) {
      const rate = here ? (o.live ? 0.4 + 2.4 * this.energy : this.phase === 'soon' ? 0.25 + 0.8 * this.energy : this.phase === 'after' ? 0.6 * this.energy : 0.08) : 0;
      this.whoopIn = rate > 0 ? -Math.log(1 - Math.random()) / rate : 1;
      if (rate > 0) this.randomWhoop(0.25 + 0.3 * this.energy);
    }

    // Their bodies: hands up through a chorus, phones up filming her.
    this.cheerIn -= dt;
    if (chorus && this.cheerIn <= 0) {
      this.cheerIn = 0.35;
      const p = this.audiencePerson();
      if (p && p.cheer < 0.3) p.cheer = 1.2 + Math.random() * 0.8;
    }
    this.film(o.live, chorus || b.intensity > 0.6);

    // The fans at the back.
    if (this.back) {
      this.avoid.length = 0;
      this.avoid.push({ x: o.you.x, z: o.you.z });
      for (const q of this.d.crowd.people) {
        if (q.away || q.performer) continue;
        if (q.pos.x < STAGE.x0 - 3.5 || q.pos.x > STAGE.x1 + 2.5 || q.pos.z < STAGE.z1 + 2.5 || q.pos.z > STAGE.z1 + 8) continue;
        this.avoid.push(q.pos);
      }
      const into = o.live ? o.into : NaN;
      this.back.update(dt, {
        beat: b,
        into,
        toLive: o.toLive,
        since: Number.isFinite(this.endedAt) ? since : Infinity,
        energy: this.energy,
        clap,
        chorus,
        her: this.d.singer?.pos ?? this.v.set(STAGE.spot.x, STAGE.y, STAGE.spot.z),
        avoid: this.avoid,
        show: here,
      });
    }

    this.prevStage = this.stage;
    this.wasLive = o.live;
    this.prevPart = o.live ? b.part : '';
    this.prevSong = o.live ? o.song : -1;
  }
  private prevStage = false;

  /**
   * Phones up: about a third of her audience film her while she's on (the
   * keenest all the time, the rest when the song lifts); everyone puts them
   * away when her set's over.
   */
  private film(live: boolean, lifted: boolean) {
    const ps = this.d.audience?.people ?? [];
    for (const p of ps) {
      const keen = (p.seed * 7.31) % 1;
      const filming = live && !p.away && p.moving < 0.2 && (keen < 0.14 || (lifted && keen < 0.34));
      if (filming && !this.filmers.has(p)) {
        this.filmers.set(p, p.prop);
        p.prop = 'phone';
        p.photo = true;
      } else if (!filming && this.filmers.has(p)) {
        p.prop = this.filmers.get(p)!;
        p.photo = false;
        this.filmers.delete(p);
      }
    }
  }

  /** For the curious (window.casino.party.hype). */
  get state() {
    return { phase: this.phase, energy: +this.energy.toFixed(2), onStage: this.stage, back: this.back?.here ?? 0, backOf: this.back?.size ?? 0, filming: this.filmers.size, log: this.log.slice(-8) };
  }
}
