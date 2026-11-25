import * as THREE from 'three';
import type { Comfort } from './player';
import { money } from './game';
import type { Hud, NavItem } from './hud';
import type { Interaction } from './interaction';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import { AVATARS } from './net/avatars';
import type { Session } from './net/session';

/**
 * Everything the screen menus offer, in VR: a tabbed panel on the left
 * wrist (point with the right controller and pull the trigger).
 *  - Go:   jump to any game, the bar or the terrace (the map).
 *  - Room: host a two-player room or join one with a code keypad, change your
 *          character, voice chat on/mute, quick chat phrases, leave the room.
 *  - Menu: music, sound, help, reset chips, exit VR.
 */

type Tab = 'go' | 'room' | 'menu' | 'keypad';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PHRASES = ["Let's go!", 'Come to roulette', 'Craps time', 'Drinks at the bar?', 'Nice!', 'One more spin'];

export interface VrMenuDeps {
  hud: Hud;
  interaction: Interaction;
  scene: THREE.Scene;
  camera: THREE.Camera;
  nav(): NavItem[];
  navigate(item: NavItem): void;
  session(): Session | null;
  host(): Promise<void>;
  join(code: string): Promise<void>;
  leaveRoom(): void;
  avatar(): number;
  setAvatar(i: number): void;
  toggleMusic(): void;
  toggleSound(): void;
  musicOn(): boolean;
  soundOn(): boolean;
  comfort(): Comfort;
  setComfort(c: Partial<Comfort>): void;
  captionsOn(): boolean;
  toggleCaptions(): void;
  resetChips(): void;
  exitVR(): void;
  helpText(): string[];
}

export class VrMenu {
  private tab: Tab = 'go';
  private code = '';
  private busy = '';
  private help: CanvasPanel;
  private helpOpen = false;

  constructor(
    private w: CanvasPanel,
    private d: VrMenuDeps,
  ) {
    d.hud.wristBuilder = () => this.build();
    this.help = new CanvasPanel(1.1, 1400, 1100, { transparent: false });
    this.help.mesh.visible = false;
    this.help.onSurface = () => this.toggleHelp(false);
    this.help.register(d.interaction);
    d.scene.add(this.help.mesh);
  }

  redraw() {
    this.build();
  }

  private go(tab: Tab) {
    this.tab = tab;
    this.build();
  }

  private build() {
    const w = this.w;
    w.buttons.length = 0;
    const d = this.d;
    const s = d.session();
    w.background = (ctx) => {
      roundRect(ctx, 4, 4, w.pxW - 8, w.pxH - 8, 36);
      ctx.fillStyle = 'rgba(14,10,8,0.94)';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textAlign = 'center';
      ctx.font = `italic 600 36px ${SERIF}`;
      ctx.fillText('Palazzo Lago', w.pxW / 2, 50);
      ctx.font = `600 46px ${SERIF}`;
      ctx.fillText(money(d.hud.balanceShown()), w.pxW / 2, 104);
      if (this.tab === 'room' || this.tab === 'keypad') {
        ctx.font = `600 30px ${SERIF}`;
        ctx.fillStyle = '#f6e7c3';
        if (this.tab === 'keypad') {
          ctx.fillText('Enter the room code', w.pxW / 2, 238);
          ctx.font = `bold 58px ${SERIF}`;
          ctx.fillStyle = '#fff3d0';
          ctx.fillText(`LAGO-${(this.code + '____').slice(0, 4)}`, w.pxW / 2, 300);
        } else if (s) {
          ctx.fillText(`Room LAGO-${s.code}`, w.pxW / 2, 236);
          ctx.font = `italic 26px ${SERIF}`;
          const f = s.friends;
          const voice = s.voice.enabled ? (s.voice.muted ? 'voice muted' : s.voice.connectedCount ? 'voice live' : 'voice on, connecting…') : 'voice off';
          ctx.fillText(`${f.length ? 'with ' + f.join(', ') : 'waiting for your friend'} · ${voice}`, w.pxW / 2, 272);
        } else {
          ctx.fillText('Two-player game', w.pxW / 2, 236);
          ctx.font = `italic 24px ${SERIF}`;
          ctx.fillText('Host to get a code for your friend, or join theirs', w.pxW / 2, 272);
        }
        if (this.busy) {
          ctx.font = `italic 26px ${SERIF}`;
          ctx.fillStyle = '#ffd98a';
          ctx.fillText(this.busy, w.pxW / 2, w.pxH - 30);
        }
      }
    };
    // Tabs.
    const tabs: [Tab, string][] = [
      ['go', 'Go'],
      ['room', 'Room'],
      ['menu', 'Menu'],
    ];
    const tw = (w.pxW - 80 - 20) / 3;
    tabs.forEach(([t, label], i) =>
      w.add({ id: `tab-${t}`, x: 40 + i * (tw + 10), y: 130, w: tw, h: 66, label, active: () => this.tab === t || (t === 'room' && this.tab === 'keypad'), onPress: () => this.go(t) }),
    );
    const col = (i: number, n = 2) => 40 + (i % n) * ((w.pxW - 80 - 12 * (n - 1)) / n + 12);
    const cw = (n = 2) => (w.pxW - 80 - 12 * (n - 1)) / n;

    if (this.tab === 'go') {
      d.nav()
        .filter((n) => !n.disabled)
        .forEach((item, i) => {
          w.add({ id: `go-${item.id}`, x: col(i), y: 218 + Math.floor(i / 2) * 84, w: cw(), h: 72, label: item.label, active: () => d.hud.station === item.id, onPress: () => d.navigate(item) });
        });
    } else if (this.tab === 'menu') {
      const items: [string, () => string, () => void][] = [
        ['music', () => (d.musicOn() ? 'Music on' : 'Music off'), () => d.toggleMusic()],
        ['sound', () => (d.soundOn() ? 'Sound on' : 'Sound off'), () => d.toggleSound()],
        ['captions', () => (d.captionsOn() ? 'Captions on' : 'Captions off'), () => d.toggleCaptions()],
        ['turn', () => (d.comfort().smoothTurn ? 'Turning: smooth' : 'Turning: snap'), () => d.setComfort({ smoothTurn: !d.comfort().smoothTurn })],
        ['tspeed', () => (d.comfort().smoothTurn ? `Turn speed: ${['slow', 'medium', 'fast'][speedIx(d.comfort().turnSpeed)]}` : `Snap: ${Math.round((d.comfort().snapAngle * 180) / Math.PI)}°`), () => {
          const c = d.comfort();
          if (c.smoothTurn) d.setComfort({ turnSpeed: [1.4, 2.2, 3.2][(speedIx(c.turnSpeed) + 1) % 3] });
          else d.setComfort({ snapAngle: Math.abs(c.snapAngle - Math.PI / 6) < 0.01 ? Math.PI / 4 : Math.abs(c.snapAngle - Math.PI / 4) < 0.01 ? Math.PI / 8 : Math.PI / 6 });
        }],
        ['vignette', () => (d.comfort().vignette ? 'Comfort vignette: on' : 'Comfort vignette: off'), () => d.setComfort({ vignette: !d.comfort().vignette })],
        ['lasers', () => (d.comfort().lasers ? 'Laser pointers: on' : 'Hands only (no lasers)'), () => d.setComfort({ lasers: !d.comfort().lasers })],
        ['help', () => 'Help', () => this.toggleHelp()],
        ['reset', () => 'Reset chips', () => d.resetChips()],
        ['exit', () => 'Exit VR', () => d.exitVR()],
      ];
      items.forEach(([id, label, fn], i) =>
        w.add({ id, x: col(i), y: 218 + Math.floor(i / 2) * 84, w: cw(), h: 72, label, onPress: () => {
          fn();
          this.build();
        } }),
      );
    } else if (this.tab === 'room') {
      let y = 300;
      if (!s) {
        w.add({ id: 'host', x: col(0), y, w: cw(), h: 78, label: 'Host 2-player', enabled: () => !this.busy, onPress: () => void this.run('Opening a room…', () => d.host()) });
        w.add({ id: 'join', x: col(1), y, w: cw(), h: 78, label: 'Join a friend', enabled: () => !this.busy, onPress: () => {
          this.code = '';
          this.go('keypad');
        } });
        y += 96;
      } else {
        const v = s.voice;
        w.add({ id: 'voice', x: col(0), y, w: cw(), h: 78, label: v.enabled ? 'Voice off' : 'Voice on', active: () => v.enabled, onPress: () => {
          if (v.enabled) v.disable();
          else void this.run('Asking for the microphone…', async () => {
            const err = await s.enableVoice();
            if (err) d.hud.toast(err, 'warn');
          });
          this.build();
        } });
        w.add({ id: 'mute', x: col(1), y, w: cw(), h: 78, label: v.muted ? 'Unmute' : 'Mute', enabled: () => v.enabled, active: () => v.muted, onPress: () => {
          v.setMuted(!v.muted);
          this.build();
        } });
        y += 92;
        PHRASES.forEach((p, i) => w.add({ id: `say-${i}`, x: col(i), y: y + Math.floor(i / 2) * 74, w: cw(), h: 62, label: p, onPress: () => s.say(p) }));
        y += 3 * 74 + 10;
      }
      // Character picker.
      w.add({ id: 'av-prev', x: 40, y, w: 90, h: 72, label: '‹', onPress: () => {
        d.setAvatar((d.avatar() + AVATARS.length - 1) % AVATARS.length);
        this.build();
      } });
      w.add({ id: 'av-name', x: 140, y, w: w.pxW - 280, h: 72, label: () => AVATARS[d.avatar()].label, enabled: () => false, onPress: () => {} });
      w.add({ id: 'av-next', x: w.pxW - 130, y, w: 90, h: 72, label: '›', onPress: () => {
        d.setAvatar((d.avatar() + 1) % AVATARS.length);
        this.build();
      } });
      y += 86;
      if (s) w.add({ id: 'leave', x: 40, y, w: w.pxW - 80, h: 66, label: 'Leave room', onPress: () => {
        d.leaveRoom();
        this.build();
      } });
    } else if (this.tab === 'keypad') {
      const kw = (w.pxW - 80 - 7 * 8) / 8;
      [...ALPHABET].forEach((ch, i) =>
        w.add({ id: `k-${ch}`, x: 40 + (i % 8) * (kw + 8), y: 330 + Math.floor(i / 8) * 76, w: kw, h: 66, label: ch, enabled: () => this.code.length < 4, onPress: () => {
          this.code += ch;
          this.build();
        } }),
      );
      const y = 330 + 4 * 76 + 6;
      w.add({ id: 'k-del', x: col(0, 3), y, w: cw(3), h: 72, label: '⌫', onPress: () => {
        this.code = this.code.slice(0, -1);
        this.build();
      } });
      w.add({ id: 'k-cancel', x: col(1, 3), y, w: cw(3), h: 72, label: 'Cancel', onPress: () => this.go('room') });
      w.add({ id: 'k-join', x: col(2, 3), y, w: cw(3), h: 72, label: 'Join', enabled: () => this.code.length === 4 && !this.busy, onPress: () => void this.run('Joining…', async () => {
        await d.join(this.code);
        this.tab = 'room';
      }) });
    }
    w.redraw();
  }

  private async run(label: string, fn: () => Promise<void>) {
    this.busy = label;
    this.build();
    try {
      await fn();
    } catch (e) {
      this.d.hud.toast((e as Error).message, 'warn');
    }
    this.busy = '';
    this.build();
  }

  private toggleHelp(open = !this.helpOpen) {
    this.helpOpen = open;
    const p = this.help;
    if (open) {
      const ctx = p.ctx;
      ctx.fillStyle = '#120c08';
      ctx.fillRect(0, 0, p.pxW, p.pxH);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, p.pxW - 16, p.pxH - 16);
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textAlign = 'center';
      ctx.font = `italic 600 64px ${SERIF}`;
      ctx.fillText('How to play', p.pxW / 2, 90);
      ctx.textAlign = 'left';
      ctx.font = `30px ${SERIF}`;
      ctx.fillStyle = '#efe3c6';
      let y = 160;
      for (const para of this.d.helpText()) {
        for (const line of wrap(ctx, para, p.pxW - 120)) {
          ctx.fillText(line, 60, y);
          y += 38;
        }
        y += 14;
        if (y > p.pxH - 80) break;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#b9a77e';
      ctx.font = `italic 28px ${SERIF}`;
      ctx.fillText('Point here and pull the trigger to close', p.pxW / 2, p.pxH - 36);
      p.texture.needsUpdate = true;
      // In front of you, at eye level.
      const cam = this.d.camera;
      const head = cam.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      fwd.y = 0;
      fwd.normalize();
      p.mesh.position.copy(head).addScaledVector(fwd, 1.2);
      p.mesh.position.y = head.y - 0.1;
      p.mesh.lookAt(head.x, p.mesh.position.y, head.z);
    }
    p.mesh.visible = open;
  }

  /** Hide the floating help when VR ends. */
  close() {
    this.toggleHelp(false);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const t = line ? line + ' ' + word : word;
    if (ctx.measureText(t).width > width && line) {
      lines.push(line);
      line = word;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function speedIx(v: number) {
  return v < 1.8 ? 0 : v < 2.7 ? 1 : 2;
}
