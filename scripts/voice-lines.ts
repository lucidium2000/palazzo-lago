/**
 * Lists every line the game speaks, with the voice that says it, for recording
 * (tools/voices/render.py). Run: npx tsx scripts/voice-lines.ts
 */
import { writeFileSync } from 'node:fs';
import { EXCHANGES, OPENERS, PASSING, WIN_REACTIONS, type Ctx, type Node } from '../src/client/dialogueLines';
import {
  BARTENDER_LINES, CHEERS_LINES, CONVO_BYE, CREW_LINES, CREW_VOICES, CROUPIER_LINES, GUEST_ALL, PACE, STAFF,
  TIPSY_LINES, lineId, orderLine, rouletteCall, sceneVoice, type Prep,
} from '../src/client/speech';
import { stickCall } from '../src/rules/craps';
import { pocketColor, pocketLabel } from '../src/rules/roulette';
import { DRINKS } from '../src/client/bar';

const out = new Map<string, { id: string; voice: string; text: string; speed: number }>();
const add = (voice: string, text: string) => {
  text = text.trim();
  if (!text) return;
  const id = lineId(voice, text);
  out.set(voice + '/' + id, { id, voice, text, speed: PACE[voice] ?? 1 });
};

// Ambient scenes: each part in its male and female voice.
const scenes = (list: typeof EXCHANGES, base: number) =>
  list.forEach((ex, e) => ex.turns.forEach(([part, text]) => [false, true].forEach((f) => add(sceneVoice(base + e, part, f), text))));
scenes(EXCHANGES, 0);
scenes(PASSING, 100);

// Things any guest may say.
for (const v of GUEST_ALL) {
  for (const t of WIN_REACTIONS) add(v, t);
  for (const t of CHEERS_LINES) add(v, t);
  add(v, CONVO_BYE.walkedOff);
  add(v, CONVO_BYE.timedOut);
}

// Conversation trees, every branch, every context.
const ctxs: Ctx[] = [
  { chips: 15000, up: 2500, drink: true, name: 'You' },
  { chips: 8000, up: -2500, drink: false, name: 'You' },
  { chips: 12500, up: 0, drink: false, name: 'You' },
];
const walk = (n: Node, voice: string) => {
  const texts = typeof n.say === 'function' ? ctxs.map((c) => (n.say as (c: Ctx) => string)(c)) : [n.say];
  texts.forEach((t) => add(voice, t));
  for (const r of n.replies ?? []) {
    if (r.end) add(voice, r.end);
    if (r.next) walk(r.next, voice);
  }
};
const staffFor: Record<string, string[]> = {
  guest: GUEST_ALL,
  pool: GUEST_ALL,
  bar: GUEST_ALL,
  bartender: [STAFF.bartender],
  waiter: [STAFF.waiter],
  croupier: [STAFF.dealer],
  'dealer-roulette': [STAFF.croupier],
  'dealer-craps': [STAFF.stickman],
};
for (const [aud, nodes] of Object.entries(OPENERS)) for (const n of nodes) for (const v of staffFor[aud]) walk(n, v);
for (const v of [STAFF.bartender, STAFF.waiter, STAFF.dealer, STAFF.croupier, STAFF.stickman]) {
  add(v, CONVO_BYE.walkedOff);
  add(v, CONVO_BYE.timedOut);
}

// Your crew.
for (const v of CREW_VOICES) {
  for (const list of Object.values(CREW_LINES)) for (const t of list) add(v, t);
  for (const t of TIPSY_LINES) add(v, t);
}

// The bar.
for (const t of Object.values(BARTENDER_LINES)) add(STAFF.bartender, t);
for (const k of DRINKS) add(STAFF.bartender, orderLine(k.name, k.prep as Prep));

// Roulette.
add(STAFF.croupier, CROUPIER_LINES.noMore);
add(STAFF.croupier, CROUPIER_LINES.place);
for (let p = 0; p < 38; p++) add(STAFF.croupier, rouletteCall(pocketLabel(p), pocketColor(p)));

// Craps: every roll in every state.
for (let a = 1; a <= 6; a++)
  for (let b = 1; b <= 6; b++)
    for (const point of [null, 4, 5, 6, 8, 9, 10]) {
      const t = a + b;
      add(STAFF.stickman, stickCall([a, b], point === null, point, point !== null && t === 7, point !== null && t === point));
    }

const lines = [...out.values()].sort((x, y) => (x.voice + x.id).localeCompare(y.voice + y.id));
writeFileSync('tools/voices/lines.json', JSON.stringify(lines, null, 1));
const per: Record<string, number> = {};
for (const l of lines) per[l.voice] = (per[l.voice] ?? 0) + 1;
console.log(lines.length, 'lines;', JSON.stringify(per));
