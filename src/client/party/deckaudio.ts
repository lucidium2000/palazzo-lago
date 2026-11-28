import { DeckDSP, type DeckParams } from './scratch';
import type { RawTrack } from './song';

/**
 * The decks' audio engine: DeckDSP (scratch.ts) running on the audio thread
 * as an AudioWorklet (its module is made from DeckDSP's own source), or, where
 * worklets can't load (a page that refuses blob: modules), on a
 * ScriptProcessor. One mono output: the party's speaker stacks play it.
 *
 * Tracks are handed over (transferred, not copied) as raw samples, and can be
 * taken back (`free`): the worklet drops its reference and the memory goes.
 */
export class DeckAudio {
  readonly output: AudioNode;
  readonly kind: 'worklet' | 'script';
  private node: AudioWorkletNode | null = null;
  private dsp: DeckDSP | null = null;
  private p: Record<keyof DeckParams, AudioParam | null> = { rateA: null, rateB: null, holdA: null, holdB: null, xf: null, volA: null, volB: null };
  /** Each record's offset as the audio thread last reported it (a record let go somewhere new). */
  readonly reported: number[] = [0, 0];
  /** Called when a record's offset changes on the audio thread (you let go of it). */
  onOffset: ((off: number[]) => void) | null = null;

  private constructor(
    private ctx: BaseAudioContext,
    node: AudioWorkletNode | ScriptProcessorNode,
  ) {
    if (node instanceof ScriptProcessorNode) {
      this.kind = 'script';
      const dsp = (this.dsp = new DeckDSP(ctx.sampleRate));
      node.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        dsp.process(out, out.length, e.playbackTime);
        if (dsp.changed) {
          dsp.changed = false;
          this.reported[0] = dsp.off[0];
          this.reported[1] = dsp.off[1];
          this.onOffset?.(this.reported);
        }
      };
    } else {
      this.kind = 'worklet';
      this.node = node;
      for (const k of Object.keys(this.p) as (keyof DeckParams)[]) this.p[k] = node.parameters.get(k) ?? null;
      node.port.onmessage = (e) => {
        const m = e.data;
        if (m?.k === 'off') {
          this.reported[0] = m.off[0];
          this.reported[1] = m.off[1];
          this.onOffset?.(this.reported);
        }
      };
    }
    this.output = node;
  }

  static async create(ctx: BaseAudioContext): Promise<DeckAudio> {
    try {
      if (!ctx.audioWorklet) throw new Error('no AudioWorklet');
      const src = `const DeckDSP = (${DeckDSP.toString()});
const PARAMS = ['rateA', 'rateB', 'holdA', 'holdB', 'xf', 'volA', 'volB'];
class PalazzoDecks extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMS.map((name) => ({ name, defaultValue: name.startsWith('rate') || name.startsWith('vol') ? 1 : 0, automationRate: 'k-rate' }));
  }
  constructor() {
    super();
    this.dsp = new DeckDSP(sampleRate);
    this.port.onmessage = (e) => {
      const m = e.data, d = this.dsp;
      if (m.k === 'rec') d.recs[m.i] = { data: m.data, sr: m.sr, loop: m.loop };
      else if (m.k === 'live') d.live = { data: m.data, sr: m.sr };
      else if (m.k === 'sched') d.sched = m.s;
      else if (m.k === 'clock') { d.t0 = m.t0; d.w0 = m.w0; }
      else if (m.k === 'speed') d.speed[m.i] = m.v;
      else if (m.k === 'off') d.setOffset(m.i, m.v);
    };
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const p = this.dsp.params;
    for (const k of PARAMS) p[k] = params[k][0];
    this.dsp.process(out, out.length, currentTime);
    if (this.dsp.changed) { this.dsp.changed = false; this.port.postMessage({ k: 'off', off: this.dsp.off.slice() }); }
    return true;
  }
}
registerProcessor('palazzo-decks', PalazzoDecks);
`;
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, 'palazzo-decks', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      return new DeckAudio(ctx, node);
    } catch (e) {
      console.warn('Decks: no AudioWorklet, using a ScriptProcessor', e);
      const sp = (ctx as AudioContext).createScriptProcessor(2048, 1, 1);
      return new DeckAudio(ctx, sp);
    }
  }

  private post(m: Record<string, unknown>, transfer: Transferable[] = []) {
    this.node?.port.postMessage(m, transfer);
  }

  /** Record `i` (0: deck A, 1: deck B), handed over: `raw.data` is unusable here afterwards. Null takes it away. */
  setRecord(i: number, raw: RawTrack | null) {
    if (this.node) {
      if (raw) this.post({ k: 'rec', i, data: raw.data, sr: raw.sampleRate, loop: raw.loop }, [raw.data.buffer]);
      else this.post({ k: 'rec', i, data: null, sr: 32000, loop: 0 });
    } else if (this.dsp) this.dsp.recs[i] = raw ? { data: raw.data, sr: raw.sampleRate, loop: raw.loop } : { data: null, sr: 32000, loop: 0 };
  }

  /** The headliner's set (null: released). */
  setLive(raw: RawTrack | null) {
    if (this.node) {
      if (raw) this.post({ k: 'live', data: raw.data, sr: raw.sampleRate }, [raw.data.buffer]);
      else this.post({ k: 'live', data: null, sr: 32000 });
    } else if (this.dsp) this.dsp.live = { data: raw ? raw.data : null, sr: raw ? raw.sampleRate : 32000 };
  }

  /** When he's on (schedule.ts): `on` 0 keeps the decks playing whatever the clock says. */
  setSchedule(s: { on: number; start: number; slot: number; cycle: number }) {
    if (this.node) this.post({ k: 'sched', s });
    else if (this.dsp) this.dsp.sched = s;
  }

  /** Wall time `w0` (s) is context time `t0`. */
  sync(t0: number, w0: number) {
    if (this.node) this.post({ k: 'clock', t0, w0 });
    else if (this.dsp) {
      this.dsp.t0 = t0;
      this.dsp.w0 = w0;
    }
  }

  /** Record `i`'s speed at rest (deck B's beat match). */
  setSpeed(i: number, v: number) {
    if (this.node) this.post({ k: 'speed', i, v });
    else if (this.dsp) this.dsp.speed[i] = v;
  }

  /** Move record `i` to offset `v` (s; crossfaded). */
  setOffset(i: number, v: number) {
    if (this.node) this.post({ k: 'off', i, v });
    else if (this.dsp) this.dsp.setOffset(i, v);
  }

  /** This frame's deck controls (smoothed a touch on the audio thread). */
  set(v: DeckParams) {
    if (this.dsp) {
      Object.assign(this.dsp.params, v);
      return;
    }
    const now = this.ctx.currentTime;
    for (const k of ['rateA', 'rateB'] as const) this.p[k]?.setTargetAtTime(v[k], now, 0.008);
    for (const k of ['holdA', 'holdB', 'xf', 'volA', 'volB'] as const) {
      const p = this.p[k];
      if (p && p.value !== v[k]) p.value = v[k];
    }
  }
}
