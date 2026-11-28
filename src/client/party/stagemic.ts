import * as THREE from 'three';
import type { Grabbable, Hands } from '../hands';
import type { Session } from '../net/session';
import type { Voice } from '../net/voice';
import { MIC_KEEP, SELF_MONITOR, Ducker, MicProximity, VoiceActivity, canGrabMic, friendRoute, rms } from './micstate';
import { PA_VOL, STACKS, buildPaChain, type PaChain } from './pachain';
import type { Stage } from './stage';

/**
 * The pool stage's mic: walk up to it (your head within ~35 cm of it, on its
 * stand or in the headliner's hand; in VR you can also lift it off the stand
 * and hold it to your mouth) and your voice comes out of the pool's speaker
 * stacks, through the PA's vocal chain (pachain.ts), and the music ducks
 * ~6 dB while you talk. Friends in your room hear you through the PA too
 * (an `onMic` flag in your state routes your voice-chat stream through the
 * same chain on their side, and silences it at your avatar meanwhile).
 *
 * The mic: voice chat's stream when it's on; otherwise the stage mic asks for
 * one the first time you step up and keeps it only while you're near the
 * stage (released past MIC_KEEP metres).
 *
 * You hear yourself a little quieter than your friends hear you
 * (SELF_MONITOR), and not at all with "Stage mic monitor" off.
 */

const MONITOR_KEY = 'palazzo-lago.stageMonitor';

interface FriendPA {
  chain: PaChain;
  src: AudioNode | null;
  vad: VoiceActivity;
}

export interface StageMicDeps {
  listener: THREE.AudioListener;
  /** The speaker stacks' anchors (the PA plays from them). */
  stacks: THREE.Object3D[];
  stage: Stage;
  hands?: Hands;
  toast: (text: string) => void;
}

export class StageMic {
  /** You're on the mic (your voice is on the PA). */
  onMic = false;
  /** You're talking into it right now. */
  talking = false;
  /** The music's ducking gain (1 = none). */
  duck = 1;
  /** Hear yourself on the PA. */
  monitor = loadMonitor();
  /** How loud you are on the mic (0..1, for your avatar's mouth when voice chat isn't on). */
  level = 0;
  private prox = new MicProximity();
  private vad = new VoiceActivity();
  private ducker = new Ducker();
  private ctx: AudioContext;
  /** The PA: every voice's chain feeds the bus, which plays from both stacks. */
  private bus: GainNode;
  private pa: THREE.PositionalAudio[] = [];
  private filters: BiquadFilterNode[] = [];
  private self: { chain: PaChain; src: MediaStreamAudioSourceNode; stream: MediaStream; out: GainNode } | null = null;
  /** The stream the stage mic asked for itself (null while it borrows voice chat's). */
  private own: MediaStream | null = null;
  private asking = false;
  private denied = false;
  private friends = new Map<string, FriendPA>();
  private session: Session | null = null;
  private buf = new Float32Array(1024);
  private micAt = new THREE.Vector3();
  private wasOn = false;
  private sincePoint = 0;

  constructor(private d: StageMicDeps) {
    this.ctx = d.listener.context;
    this.bus = this.ctx.createGain();
    for (const anchor of d.stacks) {
      const a = new THREE.PositionalAudio(d.listener);
      // Fed from a node (no playback control), so its panner follows the stack.
      (a as { hasPlaybackControl: boolean }).hasPlaybackControl = false;
      a.setRefDistance(STACKS.ref);
      a.setRolloffFactor(STACKS.rolloff);
      a.setDistanceModel('inverse');
      a.setMaxDistance(STACKS.max);
      a.setVolume(0);
      a.name = 'stage-pa';
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 20000;
      this.bus.connect(f);
      f.connect(a.getOutput());
      anchor.add(a);
      this.pa.push(a);
      this.filters.push(f);
    }
    if (d.hands) d.hands.register(this.grabbable());
  }

  /** Your room (its voice chat lends the mic; friends on the mic come through the PA). */
  connect(session: Session | null) {
    this.session = session;
    if (!session) for (const id of [...this.friends.keys()]) this.dropFriend(id);
  }

  private get voice(): Voice | null {
    return this.session?.voice ?? null;
  }

  setMonitor(on: boolean) {
    this.monitor = on;
    try {
      localStorage.setItem(MONITOR_KEY, on ? 'on' : 'off');
    } catch {
      /* private mode */
    }
  }

  /** VR: lift the mic off its stand (only while he isn't singing into it). */
  private grabbable(): Grabbable {
    const st = this.d.stage;
    return {
      at: () => st.micHead(this.micAt),
      radius: 0.12,
      enabled: () => canGrabMic(st.micOnStand, st.live),
      grab: () => st.takeMic(),
      release: () => st.returnMic(),
    };
  }

  /**
   * One frame. `head`: your eyes (camera); `screen`: not in VR; `open`/`cutoff`:
   * how much you're out at the party and the muffling through the building (as the music's).
   */
  update(dt: number, head: THREE.Vector3, screen: boolean, open: number, cutoff: number) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const mic = this.d.stage.micHead(this.micAt);
    const dist = head.distanceTo(mic);
    this.onMic = this.prox.update(head, mic, screen);

    // The PA's volume follows you out to the deck (like the music), muffled through the building.
    const vol = PA_VOL * (0.05 + 0.95 * Math.pow(open, 1.5));
    for (const a of this.pa) a.gain.gain.setTargetAtTime(vol, now, 0.05);
    for (const f of this.filters) f.frequency.setTargetAtTime(cutoff, now, 0.08);

    // Stepping up: the hint (and the browser's prompt) the first time there's no mic yet.
    if (this.onMic && !this.wasOn) this.steppedUp(head);
    this.wasOn = this.onMic;
    if (this.onMic) this.ensureSelf();
    // Walked away from the stage: the chain is torn down, and a stream of our own released.
    if (dist > MIC_KEEP) this.teardownSelf();
    // Voice chat went off under the stream we borrowed: drop it (stepping up asks for our own).
    if (this.self && this.self.stream !== this.own && this.self.stream.getAudioTracks().every((t) => t.readyState === 'ended')) this.teardownSelf(false);
    // Voice chat came on under a stream of our own: switch to its stream.
    if (this.self && this.self.stream !== this.wantStream() && this.wantStream()) this.rebuildSelf();

    // You on the PA.
    let lv = 0;
    if (this.self) {
      this.self.chain.vad.getFloatTimeDomainData(this.buf);
      lv = rms(this.buf);
      const live = this.onMic && !this.voice?.muted;
      this.vad.update(dt, live ? lv : 0);
      this.self.out.gain.setTargetAtTime(live ? (this.monitor ? SELF_MONITOR : 0) : 0, now, 0.03);
    } else this.vad.reset();
    this.talking = this.onMic && this.vad.active;
    this.level += (Math.min(1, Math.max(0, (lv - 0.012) * 9)) * (this.onMic ? 1 : 0) - this.level) * Math.min(1, dt * 12);

    // He points out to you when you step up while he's singing.
    this.sincePoint += dt;
    if (this.onMic && this.d.stage.live && this.sincePoint > 12) {
      this.sincePoint = 0;
      this.d.stage.pointAt(head);
    }

    // Friends on the mic.
    let friendTalking = false;
    const v = this.voice;
    const seen = new Set<string>();
    for (const { id, state } of this.session?.friendStates() ?? []) {
      const src = v?.remoteSource(id) ?? null;
      const route = friendRoute(!!state.onMic, !!src);
      if (route !== 'pa') continue;
      seen.add(id);
      let f = this.friends.get(id);
      if (!f) {
        const chain = buildPaChain(ctx);
        chain.output.gain.value = 1;
        chain.output.connect(this.bus);
        this.friends.set(id, (f = { chain, src: null, vad: new VoiceActivity() }));
      }
      if (f.src !== src) {
        f.src?.disconnect(f.chain.input);
        src!.connect(f.chain.input);
        f.src = src;
        v!.setOnPA(id, true);
      }
      f.chain.vad.getFloatTimeDomainData(this.buf);
      if (f.vad.update(dt, rms(this.buf))) friendTalking = true;
    }
    for (const id of [...this.friends.keys()]) if (!seen.has(id)) this.dropFriend(id);

    this.duck = this.ducker.update(dt, this.talking || friendTalking);
  }

  private steppedUp(head: THREE.Vector3) {
    if (this.d.stage.live) {
      this.sincePoint = 0;
      this.d.stage.pointAt(head);
    }
    if (this.wantStream() || this.own) this.d.toast("You're on the stage mic");
    else if (!this.denied) this.d.toast('Allow the mic to use the stage mic');
  }

  /** Voice chat's stream when it's on, else the one the stage mic asked for. */
  private wantStream(): MediaStream | null {
    return this.voice?.micStream ?? this.own;
  }

  private ensureSelf() {
    if (this.self) return;
    const s = this.wantStream();
    if (s) {
      this.buildSelf(s);
      return;
    }
    if (this.asking || this.denied) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.denied = true;
      this.d.toast('The stage mic needs a microphone (not available in this browser)');
      return;
    }
    this.asking = true;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((stream) => {
        this.asking = false;
        // Voice chat may have come on meanwhile: use its stream instead.
        if (this.voice?.micStream) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        this.own = stream;
        this.d.toast("You're on the stage mic");
      })
      .catch(() => {
        this.asking = false;
        this.denied = true;
        this.d.toast('Microphone blocked: allow it in the browser to use the stage mic');
      });
  }

  private buildSelf(stream: MediaStream) {
    const chain = buildPaChain(this.ctx);
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(chain.input);
    const out = this.ctx.createGain();
    out.gain.value = 0;
    chain.output.connect(out);
    out.connect(this.bus);
    this.self = { chain, src, stream, out };
  }

  private rebuildSelf() {
    const s = this.wantStream();
    this.teardownSelf(s !== this.own);
    if (s) this.buildSelf(s);
  }

  /** Off the PA; a stream of our own is stopped (unless `keepOwn`). Voice chat's stream is left alone. */
  private teardownSelf(stopOwn = true) {
    if (this.self) {
      this.self.src.disconnect();
      this.self.chain.dispose();
      this.self.out.disconnect();
      this.self = null;
    }
    if (stopOwn && this.own) {
      for (const t of this.own.getTracks()) t.stop();
      this.own = null;
    }
    this.vad.reset();
  }

  private dropFriend(id: string) {
    const f = this.friends.get(id);
    if (!f) return;
    try {
      f.src?.disconnect(f.chain.input);
    } catch {
      /* already gone */
    }
    f.chain.dispose();
    this.friends.delete(id);
    this.voice?.setOnPA(id, false);
  }

  /** For tests and the curious (window.casino.party.mic): what's built and how loud it is. */
  debug() {
    const meter = (an: AnalyserNode | undefined) => {
      if (!an) return null;
      an.getFloatTimeDomainData(this.buf);
      return rms(this.buf);
    };
    return {
      onMic: this.onMic,
      talking: this.talking,
      duck: this.duck,
      monitor: this.monitor,
      stream: this.self ? (this.self.stream === this.own ? 'own' : 'voice') : this.own ? 'own (idle)' : null,
      selfIn: this.self ? meter(this.self.chain.vad) : null,
      selfOut: this.self ? meter(this.self.chain.meter) : null,
      friends: [...this.friends.entries()].map(([id, f]) => ({ id, in: meter(f.chain.vad), out: meter(f.chain.meter) })),
      paVolume: this.pa.map((a) => a.getVolume()),
    };
  }
}

function loadMonitor(): boolean {
  try {
    return localStorage.getItem(MONITOR_KEY) !== 'off';
  } catch {
    return true;
  }
}
