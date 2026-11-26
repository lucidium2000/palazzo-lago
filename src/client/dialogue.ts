import * as THREE from 'three';
import type { Crowd, Person, Talk } from './people';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Interaction } from './interaction';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import { EXCHANGES, OPENERS, PASSING, WIN_REACTIONS, type Audience, type Ctx, type Exchange, type Node, type Reply } from './dialogueLines';
import { CONVO_BYE, HUH_LINES, STAFF, sceneVoice, type VoiceId } from './speech';
import { interpret, vocabulary } from './understand';
import { characterFor, elVoice, spoken, type Character } from './cast';
import type { Listener } from './listen';
import { mouthOf, voices } from './voices';
import { PLAYER_STANDIN, PLAYER_VOICES, REACTIONS, type ReactKind } from './reactlines';

/**
 * Who's speaking out loud right now. One voice at a time across the whole
 * game: your crew, the guests and the staff all check in here first.
 */
export const voiceArbiter = {
  until: 0,
  now() {
    return performance.now() / 1000;
  },
  busy() {
    return this.now() < this.until;
  },
  /** Reserve the voice for about `seconds`. */
  claim(seconds: number) {
    this.until = Math.max(this.until, this.now() + seconds);
  },
};

/** A line your game just played out loud, for your friends to hear too (net/npcsync.ts). */
export interface SpokenLine {
  /** Who said it (null: you, a reply in a conversation). */
  p: Person | null;
  kind: ReactKind | 'gasp' | 'line' | 'reply';
  text: string;
  voice: VoiceId;
  alt?: VoiceId;
  who: string;
  volume: number;
}

/** Roughly how long a line takes to say. */
export const lineTime = (text: string) => 0.9 + text.length * 0.06;

interface Scene {
  ex: Exchange;
  /** Which exchange (voices are recorded per exchange and part). */
  key: number;
  cast: Person[];
  turn: number;
  nextAt: number;
}

interface Convo {
  npc: Person;
  replies: Reply[] | null;
  /** When the NPC finishes the current line (replies show then). */
  readyAt: number;
  waitingSince: number;
  ending: boolean;
}

export interface DialogueDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  crowd: Crowd;
  sound: Sound;
  hud: Hud;
  interaction: Interaction;
  feet(): THREE.Vector3;
  inXR(): boolean;
  ctx(): Ctx;
  /** Places the conversation can't happen from (e.g. while riding an elevator). */
  enabled?(): boolean;
  /** Listens for your spoken answers (voice replies). */
  listener?: Listener;
  /** Is your character a woman (for your voice)? */
  playerFemale?(): boolean;
}

/**
 * Guests talk to each other (speech bubbles near you, the closest voiced) and
 * sometimes to you: look at someone up close and they may strike up a short
 * conversation, with two or three replies to pick (chips on screen, keys 1-3,
 * or a small panel beside them in VR). Staff speak in role.
 */
export class Dialogue {
  private scenes = new Map<Talk, Scene>();
  private idleUntil = new Map<Talk, number>();
  private passing = new Map<Person, Scene>();
  private bubbles = new Map<Person, { sprite: THREE.Sprite; until: number }>();
  private convo: Convo | null = null;
  private lookAt: Person | null = null;
  private lookFor = 0;
  private scanT = 0;
  private globalCd = 8;
  private talkedTo = new Map<Person, number>();
  private chips: HTMLElement;
  private panel: CanvasPanel;
  private time = 0;
  /** Called with every line you'd want your friends to hear (reactions, conversation lines, your replies). */
  onSpeak: ((l: SpokenLine) => void) | null = null;

  constructor(private d: DialogueDeps) {
    this.chips = document.createElement('div');
    this.chips.id = 'replies';
    document.getElementById('hud')?.appendChild(this.chips);
    this.panel = new CanvasPanel(0.56, 840, 400);
    this.panel.mesh.visible = false;
    (this.panel.mesh.material as THREE.MeshBasicMaterial).depthTest = false;
    this.panel.mesh.renderOrder = 900;
    this.panel.register(d.interaction);
    d.scene.add(this.panel.mesh);
    // Keys 1-3 answer while replies are up (before the tables' chip hotkeys).
    addEventListener(
      'keydown',
      (e) => {
        if (!this.convo?.replies || e.target instanceof HTMLInputElement) return;
        const m = e.code.match(/^Digit([1-3])$/);
        if (!m) return;
        const r = this.convo.replies[Number(m[1]) - 1];
        if (!r) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.pick(r);
      },
      true,
    );
  }

  /** Someone near `at` just won big: a guest nearby comments. */
  overheard(at: THREE.Vector3) {
    const near = this.d.crowd.people.filter((p) => !p.driven && p.role !== 'buddy' && !p.culled && p.pos.distanceTo(at) < 5 && p !== this.convo?.npc);
    const p = near[Math.floor(Math.random() * near.length)];
    if (!p) return;
    const lines = this.isGuest(p) && Math.random() < 0.7 ? this.character(p).win : WIN_REACTIONS;
    this.line(p, lines[Math.floor(Math.random() * lines.length)], { voice: p.pos.distanceTo(this.d.feet()) < 9 });
  }

  update(dt: number) {
    // The floating reply panel is for VR only; screens use the reply chips.
    if (!this.d.inXR() && this.panel.mesh.visible) this.panel.mesh.visible = false;
    this.time += dt;
    const feet = this.d.feet();
    const on = this.d.enabled?.() ?? true;
    this.ambient(feet);
    this.updateConvo(dt, feet, on);
    if (on) this.passBy(dt, feet);
    // Bubbles ride above heads and fade out.
    for (const [p, b] of this.bubbles) {
      const top = p.pos.y + (p.seated ? 1.42 : 1.95 * (p.look.height / 1.8));
      b.sprite.position.set(p.pos.x, top + 0.18, p.pos.z);
      const left = b.until - this.time;
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, left * 2.5);
      if (left <= 0 || p.culled) this.clearBubble(p);
    }
  }

  // ---------------------------------------------------------------------------
  // Ambient: guests talking among themselves
  // ---------------------------------------------------------------------------

  private ambient(feet: THREE.Vector3) {
    const now = this.time;
    // The closest live scene gets the voice.
    let nearest: { s: Scene; d: number } | null = null;
    const centre = (ps: Person[]) => {
      const c = new THREE.Vector3();
      for (const p of ps) c.add(p.pos);
      return c.divideScalar(ps.length);
    };
    for (const t of this.d.crowd.conversations) {
      const d = centre(t.members).distanceTo(feet);
      let s = this.scenes.get(t);
      if (d > 10 || t.members.some((m) => m === this.convo?.npc)) {
        if (s) this.scenes.delete(t);
        continue;
      }
      if (!s && now > (this.idleUntil.get(t) ?? 0)) {
        const pool = EXCHANGES.filter((e) => e.cast <= t.members.length);
        const ex = pool[Math.floor(Math.random() * pool.length)];
        const cast = [...t.members].sort(() => Math.random() - 0.5).slice(0, ex.cast);
        s = { ex, key: EXCHANGES.indexOf(ex), cast, turn: 0, nextAt: now + 0.6 };
        this.prefetchScene(s);
        this.scenes.set(t, s);
      }
      if (s && (!nearest || d < nearest.d)) nearest = { s, d };
    }
    // Passing chats between two people who stopped to talk.
    for (const p of this.d.crowd.people) {
      const o = p.chatWith;
      if (!o || this.passing.has(o)) continue;
      const d = p.pos.distanceTo(feet);
      let s = this.passing.get(p);
      if (!s && d < 10) {
        const ex = PASSING[Math.floor(Math.random() * PASSING.length)];
        s = { ex, key: 100 + PASSING.indexOf(ex), cast: [p, o], turn: 0, nextAt: now + 0.5 };
        this.prefetchScene(s);
        this.passing.set(p, s);
      }
      if (s && (!nearest || d < nearest.d)) nearest = { s, d };
    }
    for (const p of [...this.passing.keys()]) if (!p.chatWith) this.passing.delete(p);

    const run = (s: Scene, d: number, done: () => void) => {
      if (now < s.nextAt) return;
      const turn = s.ex.turns[s.turn];
      if (!turn) return done();
      const [k, text, laugh] = turn;
      const who = s.cast[k];
      if (!who) return done();
      // Everyone within earshot talks out loud (3D sound does the rest); the
      // crowd quiets under staff, your crew and anyone talking to you.
      const voice = voices.pick(text, elVoice(this.character(who).id), this.character(who).fallback, sceneVoice(s.key, k, isFemale(who)));
      const recorded = voices.has(voice, text);
      let dur = voices.duration(voice, text) ?? lineTime(text);
      if (recorded && d < 9) dur = voices.talk({ who: 'Guest', text, voice, at: mouthOf(who), volume: 0.85, captionFallback: false });
      else if (!recorded && nearest?.s === s && d < 6 && !this.convo && !voiceArbiter.busy()) this.voice(who, text, Math.max(0.2, Math.min(0.9, 1 - d / 7)), false);
      this.d.crowd.speak(who, dur);
      if (d < 6.5 && (voices.captions || !recorded)) this.bubble(who, text, dur + 0.4);
      if (laugh) setTimeout(() => s.cast.forEach((m) => (m.laughT = 1.2 + Math.random() * 0.4)), dur * 1000);
      s.turn++;
      s.nextAt = now + dur + 0.35 + Math.random() * 0.4;
    };
    for (const [t, s] of this.scenes) {
      const d = centre(t.members).distanceTo(feet);
      run(s, d, () => {
        this.scenes.delete(t);
        this.idleUntil.set(t, now + 5 + Math.random() * 9);
      });
    }
    for (const [p, s] of this.passing) {
      run(s, p.pos.distanceTo(feet), () => {
        s.turn = 999;
      });
    }
  }

  private passT = 0;
  private quipped = new Map<Person, number>();

  /** Walk past a guest and they may say something to you (in character). */
  private passBy(dt: number, feet: THREE.Vector3) {
    this.passT -= dt;
    if (this.passT > 0 || this.convo || voiceArbiter.busy() || voices.priorityBusy) return;
    this.passT = 0.5;
    for (const p of this.d.crowd.people) {
      if (!this.isGuest(p) || p.driven || p.culled || p.talk || p.chatWith) continue;
      const d = Math.hypot(p.pos.x - feet.x, p.pos.z - feet.z);
      if (d > 1.9 || d < 0.4) continue;
      if (this.time < (this.quipped.get(p) ?? -1e9) + 90) continue;
      this.quipped.set(p, this.time);
      if (Math.random() > 0.35) continue;
      const q = this.character(p).quips;
      p.attendUntil = this.d.crowd.now + 2.5;
      this.line(p, q[Math.floor(Math.random() * q.length)], { voice: true });
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Talking with the player
  // ---------------------------------------------------------------------------

  private audience(p: Person): Audience {
    const { x, z } = p.pos;
    if (p.role === 'croupier') {
      if (Math.hypot(x + 8.2, z - 1.5) < 3.2) return 'dealer-roulette';
      if (Math.hypot(x + 7.5, z + 7) < 3.6) return 'dealer-craps';
      return 'croupier';
    }
    if (p.role === 'bartender') return 'bartender';
    if (p.role === 'waiter') return 'waiter';
    if (x > 21 && z < 0) return 'pool';
    if (x < -11 && z > 5) return 'bar';
    return 'guest';
  }

  private updateConvo(dt: number, feet: THREE.Vector3, on: boolean) {
    const c = this.convo;
    if (c) {
      const d = c.npc.pos.distanceTo(feet);
      c.npc.attendUntil = this.d.crowd.now + 1.5;
      if (!on || d > 3.6) return this.endConvo(d < 6 ? (this.isGuest(c.npc) ? this.character(c.npc).bye.walkedOff : CONVO_BYE.walkedOff) : null);
      if (this.time >= c.readyAt) {
        if (c.ending) return this.endConvo(null);
        if (c.replies && c.waitingSince === 0) {
          c.waitingSince = this.time;
          this.showReplies(c.replies);
          this.listenFor(c, 2);
        }
        if (c.replies && this.time - c.waitingSince > 15) return this.endConvo(this.isGuest(c.npc) ? this.character(c.npc).bye.timedOut : CONVO_BYE.timedOut);
      }
      if (c.replies && this.d.inXR()) this.placePanel(c.npc);
      return;
    }
    this.globalCd -= dt;
    if (!on || this.globalCd > 0) return;
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.2;
    // Who are you looking at, up close?
    const cam = this.d.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    let best: Person | null = null,
      bestScore = 0.5;
    for (const p of this.d.crowd.people) {
      if (p.driven || p.role === 'buddy' || p.role === 'pianist' || p.culled || p.photo) continue;
      const to = new THREE.Vector3(p.pos.x - feet.x, 0, p.pos.z - feet.z);
      const dist = to.length();
      const reach = p.role === 'croupier' || p.role === 'bartender' ? 3.0 : 2.2;
      if (dist > reach || dist < 0.3) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(to.normalize().dot(fwd), -1, 1));
      if (ang > 0.45) continue;
      const score = 1 - ang;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best !== this.lookAt) {
      this.lookAt = best;
      this.lookFor = 0;
    }
    if (!best) return;
    this.lookFor += 0.2;
    const staff = best.role === 'croupier' || best.role === 'bartender' || best.role === 'waiter';
    if (this.lookFor < (staff ? 0.6 : 1.0)) return;
    if (this.time < (this.talkedTo.get(best) ?? -1e9) + (staff ? 60 : 150)) return;
    if (voiceArbiter.busy() || voices.priorityBusy) return;
    this.startConvo(best);
  }

  private startConvo(p: Person) {
    const aud = this.audience(p);
    // Guests mostly talk like themselves (their own openers), sometimes small talk.
    const own = this.isGuest(p) && (aud === 'guest' || aud === 'pool' || aud === 'bar') && Math.random() < 0.75;
    const list = own ? this.character(p).openers : OPENERS[aud];
    const node = list[Math.floor(Math.random() * list.length)];
    this.talkedTo.set(p, this.time);
    this.prefetchTree(node, this.voiceOf(p));
    // Their circle pauses while they talk to you.
    if (p.talk) this.scenes.delete(p.talk);
    this.convo = { npc: p, replies: null, readyAt: 0, waitingSince: 0, ending: false };
    this.say(node);
  }

  private say(node: Node) {
    const c = this.convo!;
    const text = typeof node.say === 'function' ? node.say(this.d.ctx()) : node.say;
    const dur = this.line(c.npc, text, { voice: true, priority: true, subtitle: true });
    c.readyAt = this.time + Math.min(dur, 2.2);
    c.replies = node.replies ?? null;
    c.waitingSince = 0;
    c.ending = !node.replies;
    if (c.ending) c.readyAt = this.time + dur;
  }

  /**
   * Voice replies: while the replies are up, listen for your answer. A clear
   * answer picks that reply; something they didn't catch gets a laugh-it-off
   * line and they carry on as if you'd said one of the replies.
   */
  private listenFor(c: Convo, tries: number) {
    const l = this.d.listener;
    const replies = c.replies;
    if (!l?.enabled || !replies) return;
    void l.listen(vocabulary(replies), 7).then((heard) => {
      if (this.convo !== c || c.replies !== replies) return;
      if (heard === null) return; // can't listen here: the reply buttons still work
      if (!heard) {
        if (tries > 1) this.listenFor(c, tries - 1);
        return;
      }
      const i = interpret(heard, replies);
      if (i !== null) return this.pick(replies[i], true);
      // Didn't catch it: roll with it.
      const pool = this.isGuest(c.npc) && Math.random() < 0.7 ? this.character(c.npc).huh : HUH_LINES;
      const huh = pool[Math.floor(Math.random() * pool.length)];
      this.hideReplies();
      c.replies = null;
      const dur = this.line(c.npc, huh, { voice: true, priority: true });
      const r = replies[Math.floor(Math.random() * replies.length)];
      setTimeout(() => {
        if (this.convo !== c) return;
        // Carry on down a random branch (its follow-up line), or wrap up.
        if (r.next) this.say(r.next);
        else this.endConvo(null);
      }, (dur + 0.3) * 1000);
      c.readyAt = this.time + dur + 9;
    });
  }

  private pick(r: Reply, spokenAloud = false) {
    const c = this.convo;
    if (!c) return;
    this.d.listener?.stop();
    this.hideReplies();
    if (voices.captions) this.d.hud.say('You', r.label);
    // You say it (unless you already did, into the mic); they answer once you're done.
    const mine = spokenAloud ? 0 : this.sayMine(r.label);
    const wait = Math.max(500, mine * 1000 + 250);
    c.replies = null;
    if (r.next) this.prefetchTree(r.next, this.voiceOf(c.npc));
    else if (r.end) voices.prefetch(this.voiceOf(c.npc), r.end);
    if (r.next) {
      setTimeout(() => this.convo === c && this.say(r.next!), wait);
      c.readyAt = this.time + 9;
    } else {
      setTimeout(() => {
        if (this.convo !== c) return;
        if (r.end) this.say({ say: r.end });
        else this.endConvo(null);
      }, 500);
      c.readyAt = this.time + 9;
    }
  }

  private endConvo(last: string | null) {
    const c = this.convo;
    if (!c) return;
    if (last) this.line(c.npc, last, { voice: c.npc.pos.distanceTo(this.d.feet()) < 4, priority: true });
    c.npc.attendUntil = this.d.crowd.now + 1.2;
    this.d.listener?.stop();
    this.convo = null;
    this.hideReplies();
    this.globalCd = 12 + Math.random() * 10;
    this.lookAt = null;
  }

  /** Someone says a line: their own recorded voice from where they stand (bubble and caption if wanted). */
  private line(p: Person, text: string, o: { voice?: boolean; priority?: boolean; subtitle?: boolean } = {}) {
    const voice = voices.pick(text, ...this.voicesOf(p));
    const recorded = voices.has(voice, text);
    let dur = voices.duration(voice, text) ?? lineTime(text);
    if (o.priority && o.voice) this.onSpeak?.({ p, kind: 'line', text, voice, alt: this.voicesOf(p)[1], who: this.title(p), volume: 1 });
    if (recorded && o.voice) {
      dur = voices.talk({ who: this.title(p), text, voice, at: mouthOf(p), priority: o.priority, group: o.priority ? 'convo' : undefined, captionFallback: false });
      if (o.priority) voiceArbiter.claim(dur);
    } else {
      if (o.subtitle) this.d.hud.say(this.title(p), spoken(text));
      if (o.voice && (o.priority || !voiceArbiter.busy())) this.voice(p, text, 1, !!o.priority);
    }
    this.d.crowd.speak(p, dur);
    if (voices.captions || !recorded) this.bubble(p, spoken(text), dur + 0.8);
    return dur;
  }

  private reactCool = new WeakMap<Person, number>();
  /** The last reaction line chosen by react() (what your friends were sent). */
  lastReaction: string | null = null;

  /**
   * Someone you got physical with answers back, out loud, in their own voice: a word when bumped or
   * pushed, a loud "ouch" when punched, anger when doused or hit by something thrown. `crew` names
   * one of your boys (rocco, dev, mikey) with their stand-in voice. Returns how long they talk.
   */
  react(p: Person, kind: ReactKind, crew?: { name: string; voice: VoiceId }, say?: string): number {
    const t = this.time;
    // One reaction at a time per person (a punch always gets its yell).
    if ((this.reactCool.get(p) ?? -9) > t && kind !== 'punched') return 0;
    let id: string;
    let alt: VoiceId;
    if (crew) {
      id = 'crew_' + crew.name.toLowerCase();
      alt = crew.voice;
    } else if (p.role === 'pianist') {
      // The pianist has no lines of his own: the roulette croupier's voice (a man in black tie), minus his table talk.
      id = 'croupier';
      alt = STAFF.croupier;
    } else if (p.role === 'bartender' || p.role === 'waiter' || p.role === 'croupier') {
      const v = this.voicesOf(p);
      id = v[0].replace(/^el_/, '');
      alt = v[1];
    } else {
      const ch = this.character(p);
      id = ch.id;
      alt = ch.fallback;
    }
    const set = REACTIONS[id]?.[kind]?.filter((l) => p.role !== 'pianist' || !/wheel|table|play elsewhere/i.test(l));
    if (!set?.length) return 0;
    // Recorded lines only (never the robot voice): until they're in, a gasp or a yelp.
    const said = set.filter((l) => voices.has(elVoice(id), l) || voices.has(alt, l));
    if (!said.length) {
      if (kind === 'pushed') return 0;
      this.onSpeak?.({ p, kind: 'gasp', text: '', voice: alt, who: this.title(p), volume: kind === 'punched' ? 1 : 0.6 });
      this.d.sound.play('gasp', p.pos.clone().setY(p.pos.y + 1.5), { volume: kind === 'punched' ? 1 : 0.6, rate: kind === 'punched' ? 0.9 : 1.1 });
      this.reactCool.set(p, t + 1.2);
      return 0.8;
    }
    // `say`: a line already chosen (the same one everyone in the room hears).
    const text = say && said.includes(say) ? say : said[Math.floor(Math.random() * said.length)];
    this.lastReaction = text;
    // Offended: whatever you were talking about is over.
    if (kind !== 'pushed' && this.convo?.npc === p) {
      this.hideReplies();
      this.d.listener?.stop();
      this.convo = null;
    }
    const loud = kind === 'punched' ? 1.5 : kind === 'pushed' ? 0.85 : 1.35;
    this.onSpeak?.({ p, kind, text, voice: elVoice(id), alt, who: this.title(p), volume: loud });
    const dur = voices.talk({ who: this.title(p), text, voice: elVoice(id), alt, at: mouthOf(p), priority: kind !== 'pushed', group: 'react', volume: loud, fallback: { rate: kind === 'punched' ? 1.15 : 1.05, pitch: kind === 'punched' ? 1.15 : 1 } });
    this.reactCool.set(p, t + Math.max(1.2, dur));
    this.d.crowd.speak(p, dur);
    p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + dur + (kind === 'pushed' ? 1 : 4));
    // Nobody chats you up for a while after that.
    if (kind !== 'pushed') this.globalCd = Math.max(this.globalCd, 12);
    return dur;
  }

  /**
   * A line a friend's game played (someone reacting to them, talking to them, or the friend's own
   * reply): the same recorded take, from that person here (`p`) or else from the spot (`at`, feet).
   * Returns how long it lasts.
   */
  hear(l: { kind: SpokenLine['kind']; text: string; voice: string; alt?: string; who: string; volume: number }, p: Person | null, at: THREE.Vector3, speaker?: Person | null): number {
    const anchor = p ?? speaker ?? { pos: at, seated: false, look: { height: 1.75 } };
    if (l.kind === 'gasp') {
      this.d.sound.play('gasp', anchor.pos.clone().setY(anchor.pos.y + 1.5), { volume: l.volume, rate: l.volume >= 1 ? 0.9 : 1.1 });
      return 0.8;
    }
    const react = l.kind === 'pushed' || l.kind === 'punched' || l.kind === 'doused' || l.kind === 'hit';
    const dur = voices.talk({
      who: l.who,
      text: l.text,
      voice: l.voice as VoiceId,
      alt: l.alt as VoiceId | undefined,
      at: mouthOf(anchor),
      priority: react && l.kind !== 'pushed',
      group: 'friend-' + l.kind,
      volume: l.volume,
      captionFallback: false,
      fallback: { rate: l.kind === 'punched' ? 1.15 : 1.05, pitch: l.kind === 'punched' ? 1.15 : 1 },
    });
    if (p) {
      this.d.crowd.speak(p, dur);
      if (react) this.reactCool.set(p, this.time + Math.max(1.2, dur));
      if (voices.captions) this.bubble(p, spoken(l.text), dur + 0.8);
    }
    return dur;
  }

  /** Your chosen reply, out loud, in your own character's voice (so it's a conversation, not a menu). */
  private sayMine(label: string) {
    const fem = this.d.playerFemale?.() ?? false;
    const voice = elVoice(fem ? PLAYER_VOICES.female : PLAYER_VOICES.male);
    const alt = fem ? PLAYER_STANDIN.female : PLAYER_STANDIN.male;
    if (!voices.has(voice, label) && !voices.has(alt, label)) return 0;
    this.onSpeak?.({ p: null, kind: 'reply', text: label, voice, alt, who: 'You', volume: 0.75 });
    return voices.talk({ who: 'You', text: label, voice, alt, at: null, volume: 0.75, group: 'me', captionFallback: false });
  }

  /** The recorded voice a person speaks with (staff by job, guests their own). */
  voiceOf(p: Person): VoiceId {
    return this.voicesOf(p)[0];
  }

  /** A person's voices: their own (ElevenLabs) first, then the stand-in recorded before it. */
  voicesOf(p: Person): [VoiceId, VoiceId] {
    if (p.role === 'bartender') return [elVoice('bartender'), STAFF.bartender];
    if (p.role === 'waiter') return isFemale(p) ? [elVoice('waitress'), STAFF.waitress] : [elVoice('waiter'), STAFF.waiter];
    if (p.role === 'croupier') {
      const a = this.audience(p);
      return a === 'dealer-roulette' ? [elVoice('croupier'), STAFF.croupier] : a === 'dealer-craps' ? [elVoice('stickman'), STAFF.stickman] : [elVoice('dealer'), STAFF.dealer];
    }
    const ch = this.character(p);
    return [elVoice(ch.id), ch.fallback];
  }

  /** The regular a guest is played by (their personality and lines). */
  character(p: Person): Character {
    return characterFor(p.seed, isFemale(p));
  }

  private isGuest(p: Person) {
    return p.role !== 'bartender' && p.role !== 'waiter' && p.role !== 'croupier' && p.role !== 'buddy';
  }

  private prefetchScene(s: Scene) {
    for (const [k, text] of s.ex.turns) {
      const who = s.cast[k];
      if (who) voices.prefetch(sceneVoice(s.key, k, isFemale(who)), text);
    }
  }

  private prefetchTree(n: Node, voice: VoiceId) {
    if (typeof n.say === 'string') voices.prefetch(voice, n.say);
    else voices.prefetch(voice, n.say(this.d.ctx()));
    for (const r of n.replies ?? []) if (r.end) voices.prefetch(voice, r.end);
  }

  private title(p: Person) {
    if (p.role === 'croupier') return 'Dealer';
    if (p.role === 'bartender') return 'Bartender';
    if (p.role === 'waiter') return 'Waiter';
    if (p.role === 'pianist') return 'Pianist';
    return this.character(p).name;
  }

  /** Browser-speech fallback: each person keeps their own voice, pitch and pace. */
  private voice(p: Person, text: string, volume: number, interrupt: boolean) {
    const female = (p.look.kind ?? '').startsWith('female') || p.look.dress;
    const s = p.seed;
    this.d.sound.say(text, {
      voice: Math.floor(s * 7) % 9,
      pitch: female ? 1.12 + ((s * 13) % 1) * 0.22 : 0.82 + ((s * 13) % 1) * 0.22,
      rate: 0.95 + ((s * 29) % 1) * 0.14,
      volume,
      interrupt,
    });
    voiceArbiter.claim(lineTime(text));
  }

  private bubble(p: Person, text: string, seconds: number) {
    this.clearBubble(p);
    const sprite = bubbleSprite(text);
    this.d.scene.add(sprite);
    this.bubbles.set(p, { sprite, until: this.time + seconds });
  }

  private clearBubble(p: Person) {
    const b = this.bubbles.get(p);
    if (!b) return;
    this.d.scene.remove(b.sprite);
    b.sprite.material.map?.dispose();
    b.sprite.material.dispose();
    this.bubbles.delete(p);
  }

  // ---------------------------------------------------------------------------
  // Reply UI: chips on screen, a small panel in VR
  // ---------------------------------------------------------------------------

  private showReplies(replies: Reply[]) {
    this.chips.innerHTML = '';
    replies.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'reply';
      b.innerHTML = `<b>${i + 1}</b> ${escapeHtml(r.label)}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pick(r);
      });
      this.chips.appendChild(b);
    });
    this.chips.classList.add('on');
    // VR panel with the same choices.
    const p = this.panel;
    p.buttons.length = 0;
    p.background = (ctx) => {
      roundRect(ctx, 4, 4, p.pxW - 8, p.pxH - 8, 30);
      ctx.fillStyle = 'rgba(14,10,8,0.9)';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textAlign = 'center';
      ctx.font = `italic 600 30px ${SERIF}`;
      ctx.fillText('Your reply', p.pxW / 2, 42);
    };
    const h = Math.min(100, (p.pxH - 80) / replies.length - 12);
    replies.forEach((r, i) => p.add({ id: `r${i}`, x: 30, y: 66 + i * (h + 12), w: p.pxW - 60, h, label: r.label, onPress: () => this.pick(r) }));
    p.redraw();
    p.mesh.visible = false;
    if (this.convo && this.d.inXR()) this.placePanel(this.convo.npc);
  }

  private hideReplies() {
    this.chips.classList.remove('on');
    this.chips.innerHTML = '';
    this.panel.mesh.visible = false;
  }

  /**
   * The reply panel sits within arm's reach (chest high, a little toward the person you're talking to),
   * so you answer by touching it. It stays put while you lean in to press, and only re-settles if you
   * walk off or turn away.
   */
  private placePanel(npc: Person) {
    const head = this.d.camera.getWorldPosition(new THREE.Vector3());
    const m = this.panel.mesh;
    if (m.visible) {
      const dx = m.position.x - head.x,
        dz = m.position.z - head.z;
      const reach = Math.hypot(dx, dz);
      const look = this.d.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const facing = reach > 1e-3 ? (dx * look.x + dz * look.z) / reach : 1;
      if (reach > 0.2 && reach < 0.8 && facing > 0.35 && Math.abs(m.position.y - (head.y - 0.3)) < 0.35) return;
    }
    const toNpc = new THREE.Vector3(npc.pos.x - head.x, 0, npc.pos.z - head.z);
    const look = this.d.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (look.lengthSq() < 1e-4) look.copy(toNpc);
    look.normalize();
    // Between where you look and where they stand (mostly where you look).
    const dir = toNpc.lengthSq() > 1e-4 ? look.clone().lerp(toNpc.normalize(), 0.35).normalize() : look;
    m.scale.setScalar(0.68);
    m.position.set(head.x, head.y - 0.3, head.z).addScaledVector(dir, 0.42);
    m.lookAt(head.x, head.y - 0.05, head.z);
    m.visible = true;
  }
}

function isFemale(p: Person) {
  return (p.look.kind ?? '').startsWith('female') || !!p.look.dress;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A speech bubble sprite (cream card with a tail), sized to its text. */
function bubbleSprite(text: string): THREE.Sprite {
  const font = '30px Georgia, serif';
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = font;
  // Wrap long lines onto two rows.
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > 420 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  const w = Math.min(500, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 44);
  const h = 22 + lines.length * 36 + 18;
  c.width = w;
  c.height = h + 16;
  g.font = font;
  g.fillStyle = 'rgba(250,244,230,0.96)';
  g.beginPath();
  g.roundRect(2, 2, w - 4, h - 4, 22);
  g.fill();
  g.beginPath();
  g.moveTo(w / 2 - 12, h - 3);
  g.lineTo(w / 2, h + 14);
  g.lineTo(w / 2 + 12, h - 3);
  g.fill();
  g.strokeStyle = '#d4a94e';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(2, 2, w - 4, h - 4, 22);
  g.stroke();
  g.fillStyle = '#2a1a10';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, w / 2, 22 + i * 36 + 12));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  const scale = 0.0024;
  s.scale.set(c.width * scale, c.height * scale, 1);
  s.center.set(0.5, 0);
  s.raycast = () => {};
  s.renderOrder = 10;
  return s;
}
