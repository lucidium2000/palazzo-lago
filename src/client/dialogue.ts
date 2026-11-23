import * as THREE from 'three';
import type { Crowd, Person, Talk } from './people';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Interaction } from './interaction';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import { EXCHANGES, OPENERS, PASSING, WIN_REACTIONS, type Audience, type Ctx, type Exchange, type Node, type Reply } from './dialogueLines';

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

/** Roughly how long a line takes to say. */
export const lineTime = (text: string) => 0.9 + text.length * 0.06;

interface Scene {
  ex: Exchange;
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

  constructor(private d: DialogueDeps) {
    this.chips = document.createElement('div');
    this.chips.id = 'replies';
    document.getElementById('hud')?.appendChild(this.chips);
    this.panel = new CanvasPanel(0.42, 840, 400);
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
    this.line(p, WIN_REACTIONS[Math.floor(Math.random() * WIN_REACTIONS.length)], { voice: p.pos.distanceTo(this.d.feet()) < 6 });
  }

  update(dt: number) {
    this.time += dt;
    const feet = this.d.feet();
    const on = this.d.enabled?.() ?? true;
    this.ambient(feet);
    this.updateConvo(dt, feet, on);
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
        s = { ex, cast, turn: 0, nextAt: now + 0.5 };
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
        s = { ex, cast: [p, o], turn: 0, nextAt: now + 0.4 };
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
      const dur = lineTime(text);
      this.d.crowd.speak(who, dur);
      if (d < 6.5) this.bubble(who, text, dur + 0.4);
      const voiced = nearest?.s === s && d < 6 && !this.convo && !voiceArbiter.busy();
      if (voiced) this.voice(who, text, Math.max(0.2, Math.min(0.9, 1 - d / 7)), false);
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
      if (!on || d > 3.6) return this.endConvo(d < 6 ? 'Alright, enjoy your night!' : null);
      if (this.time >= c.readyAt) {
        if (c.ending) return this.endConvo(null);
        if (c.replies && c.waitingSince === 0) {
          c.waitingSince = this.time;
          this.showReplies(c.replies);
        }
        if (c.replies && this.time - c.waitingSince > 15) return this.endConvo('No worries. Have a good one!');
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
    if (voiceArbiter.busy()) return;
    this.startConvo(best);
  }

  private startConvo(p: Person) {
    const list = OPENERS[this.audience(p)];
    const node = list[Math.floor(Math.random() * list.length)];
    this.talkedTo.set(p, this.time);
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

  private pick(r: Reply) {
    const c = this.convo;
    if (!c) return;
    this.hideReplies();
    this.d.hud.say('You', r.label);
    c.replies = null;
    if (r.next) {
      setTimeout(() => this.convo === c && this.say(r.next!), 500);
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
    this.convo = null;
    this.hideReplies();
    this.globalCd = 12 + Math.random() * 10;
    this.lookAt = null;
  }

  /** Someone says a line: bubble, gestures, and (if asked and free) their voice. */
  private line(p: Person, text: string, o: { voice?: boolean; priority?: boolean; subtitle?: boolean } = {}) {
    const dur = lineTime(text);
    this.d.crowd.speak(p, dur);
    this.bubble(p, text, dur + 0.8);
    if (o.subtitle) this.d.hud.say(this.title(p), text);
    if (o.voice && (o.priority || !voiceArbiter.busy())) this.voice(p, text, 1, !!o.priority);
    return dur;
  }

  private title(p: Person) {
    if (p.role === 'croupier') return 'Dealer';
    if (p.role === 'bartender') return 'Bartender';
    if (p.role === 'waiter') return 'Waiter';
    return 'Guest';
  }

  /** Each person keeps their own voice, pitch and pace. */
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
    p.mesh.visible = this.d.inXR();
    if (this.convo) this.placePanel(this.convo.npc);
  }

  private hideReplies() {
    this.chips.classList.remove('on');
    this.chips.innerHTML = '';
    this.panel.mesh.visible = false;
  }

  /** The reply panel floats beside the person you're talking to, facing you. */
  private placePanel(npc: Person) {
    const head = this.d.camera.getWorldPosition(new THREE.Vector3());
    const to = new THREE.Vector3(head.x - npc.pos.x, 0, head.z - npc.pos.z).normalize();
    const side = new THREE.Vector3(to.z, 0, -to.x);
    const m = this.panel.mesh;
    m.position.set(npc.pos.x, head.y - 0.35, npc.pos.z).addScaledVector(to, 0.55).addScaledVector(side, 0.35);
    m.lookAt(head);
    m.visible = true;
  }
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
    if (g.measureText(t).width > 520 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  const w = Math.min(600, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 44);
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
  const scale = 0.0006;
  s.scale.set(c.width * scale, c.height * scale, 1);
  s.center.set(0.5, 0);
  s.raycast = () => {};
  s.renderOrder = 10;
  return s;
}
