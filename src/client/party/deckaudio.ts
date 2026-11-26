import { DeckDSP, type DeckParams } from './scratch';
import type { RawTrack } from './song';

/**
 * The decks' audio engine: DeckDSP (scratch.ts) running on the audio thread
 * as an AudioWorklet (its module is made from DeckDSP's own source), or, where
 * worklets can't load (a page that refuses blob: modules), on a
 * ScriptProcessor. One mono output: the party's speaker stacks play it.
 *
 * The tracks are handed over (transferred, not copied) as raw samples.
 */
export class DeckAudio {
  readonly output: AudioNode;
  readonly kind: 'worklet' | 'script';
  private node: AudioWorkletNode | null = null;
  private dsp: DeckDSP | null = null;
  private p: Record<keyof DeckParams, AudioParam | null> = { rateA: null, rateB: null, holdA: null, holdB: null, xf: null };

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
      };
    } else {
      this.kind = 'worklet';
      this.node = node;
      for (const k of Object.keys(this.p) as (keyof DeckParams)[]) this.p[k] = node.parameters.get(k) ?? null;
    }
    this.output = node;
  }

  static async create(ctx: BaseAudioContext): Promise<DeckAudio> {
    try {
      if (!ctx.audioWorklet) throw new Error('no AudioWorklet');
      const src = `const DeckDSP = (${DeckDSP.toString()});
class PalazzoDecks extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ['rateA', 'rateB', 'holdA', 'holdB', 'xf'].map((name) => ({ name, defaultValue: name.startsWith('rate') ? 1 : 0, automationRate: 'k-rate' }));
  }
  constructor() {
    super();
    this.dsp = new DeckDSP(sampleRate);
    this.port.onmessage = (e) => {
      const m = e.data, d = this.dsp;
      if (m.k === 'track') { d.tracks[m.i] = m.data; d.trackRate = m.rate; d.trackLoop = m.loop; for (let i = 0; i < m.n; i++) if (d.tracks[i] === undefined) d.tracks[i] = null; }
      else if (m.k === 'rec') { d.rec = m.data; d.recRate = m.rate; d.recLoop = m.loop; }
      else if (m.k === 'clock') { d.t0 = m.t0; d.p0 = m.p0; }
    };
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const p = this.dsp.params;
    p.rateA = params.rateA[0]; p.rateB = params.rateB[0]; p.holdA = params.holdA[0]; p.holdB = params.holdB[0]; p.xf = params.xf[0];
    this.dsp.process(out, out.length, currentTime);
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

  /** Track `i` of the set (of `n`), handed over: `raw.data` is unusable here afterwards. */
  setTrack(i: number, n: number, raw: RawTrack) {
    if (this.node) this.node.port.postMessage({ k: 'track', i, n, data: raw.data, rate: raw.sampleRate, loop: raw.loop }, [raw.data.buffer]);
    else if (this.dsp) {
      const d = this.dsp;
      d.tracks[i] = raw.data;
      for (let k = 0; k < n; k++) if (d.tracks[k] === undefined) d.tracks[k] = null;
      d.trackRate = raw.sampleRate;
      d.trackLoop = raw.loop;
    }
  }

  setRecord(raw: RawTrack) {
    if (this.node) this.node.port.postMessage({ k: 'rec', data: raw.data, rate: raw.sampleRate, loop: raw.loop }, [raw.data.buffer]);
    else if (this.dsp) {
      this.dsp.rec = raw.data;
      this.dsp.recRate = raw.sampleRate;
      this.dsp.recLoop = raw.loop;
    }
  }

  /** The set is `p0` seconds in at context time `t0`. */
  sync(t0: number, p0: number) {
    if (this.node) this.node.port.postMessage({ k: 'clock', t0, p0 });
    else if (this.dsp) {
      this.dsp.t0 = t0;
      this.dsp.p0 = p0;
    }
  }

  /** This frame's deck controls (smoothed a touch on the audio thread). */
  set(v: DeckParams) {
    if (this.dsp) {
      Object.assign(this.dsp.params, v);
      return;
    }
    const now = this.ctx.currentTime;
    for (const k of ['rateA', 'rateB'] as const) this.p[k]?.setTargetAtTime(v[k], now, 0.008);
    for (const k of ['holdA', 'holdB', 'xf'] as const) {
      const p = this.p[k];
      if (p && p.value !== v[k]) p.value = v[k];
    }
  }
}
