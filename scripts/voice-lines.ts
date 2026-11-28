/**
 * Lists every line the game speaks, with the voice that says it, for recording
 * (tools/voices/render.py). Run: npx tsx scripts/voice-lines.ts
 */
import { writeFileSync } from 'node:fs';
import { REACTIONS, PLAYER_VOICES, PLAYER_STANDIN, replyLabels } from '../src/client/reactlines';
import { EXCHANGES, OPENERS, PASSING, WIN_REACTIONS, type Ctx, type Node } from '../src/client/dialogueLines';
import {
  BARTENDER_LINES, CHEERS_LINES, CONVO_BYE, HUH_LINES, CREW_DAP_LINES, CREW_LINES, CREW_VOICES, CROUPIER_LINES, GUEST_ALL, PACE, STAFF,
  TIPSY_LINES, lineId, orderLine, rouletteCall, sceneVoice, type Prep,
} from '../src/client/speech';
import { stickCall } from '../src/rules/craps';
import { pocketColor, pocketLabel } from '../src/rules/roulette';
import { DRINKS } from '../src/client/bar';
import { promenadeLines } from '../src/client/promenadelines';
import { smallTalkLines } from '../src/client/smalltalk';

const out = new Map<string, { id: string; voice: string; text: string; say?: string; speed: number }>();
const add = (voice: string, text: string) => {
  text = text.trim();
  if (!text) return;
  const id = lineId(voice, text);
  // Kokoro reads [tags] aloud: it gets the words only (the id stays the game's text).
  const say = text.replace(/\s*\[[^\]]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  out.set(voice + '/' + id, { id, voice, text, ...(say !== text ? { say } : {}), speed: PACE[voice] ?? 1 });
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
  for (const t of HUH_LINES) add(v, t);
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
  waiter: [STAFF.waiter, STAFF.waitress],
  croupier: [STAFF.dealer],
  'dealer-roulette': [STAFF.croupier],
  'dealer-craps': [STAFF.stickman],
};
for (const [aud, nodes] of Object.entries(OPENERS)) for (const n of nodes) for (const v of staffFor[aud]) walk(n, v);
for (const v of [STAFF.bartender, STAFF.waiter, STAFF.waitress, STAFF.dealer, STAFF.croupier, STAFF.stickman]) {
  add(v, CONVO_BYE.walkedOff);
  add(v, CONVO_BYE.timedOut);
  for (const t of HUH_LINES) add(v, t);
}

// Off-script answers (smalltalk.ts): staff names, how they're doing, directions.
for (const [id, list] of Object.entries(smallTalkLines().staff)) for (const t of list) add(STAFF[id as keyof typeof STAFF], t);

// Your crew.
for (const v of CREW_VOICES) {
  for (const list of Object.values(CREW_LINES)) for (const t of list) add(v, t);
  for (const t of CREW_DAP_LINES) add(v, t);
  for (const t of TIPSY_LINES) add(v, t);
}

// The bar.
for (const t of Object.values(BARTENDER_LINES)) add(STAFF.bartender, t);
for (const k of DRINKS) add(STAFF.bartender, orderLine(k.name, k.prep as Prep));

// The Promenade: the food court's cooks and the boutique's clerk (every dish named, one line each).
for (const [who, list] of Object.entries(promenadeLines())) for (const t of list) add(STAFF[who as keyof typeof STAFF], t);

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

// The regulars' own lines in their stand-in voices (until their ElevenLabs takes are in), and the
// shared lines they can say (already recorded for every guest voice above).
{
  const { GUESTS } = await import('../src/client/cast');
  const walkK = (n: Node, voice: string) => {
    const texts = typeof n.say === 'function' ? ctxs.map((c) => (n.say as (c: Ctx) => string)(c)) : [n.say];
    texts.forEach((t) => add(voice, t));
    for (const r of n.replies ?? []) {
      if (r.end) add(voice, r.end);
      if (r.next) walkK(r.next, voice);
    }
  };
  for (const ch of GUESTS) {
    for (const n of ch.openers) walkK(n, ch.fallback);
    for (const t of [...ch.quips, ...ch.win, ...ch.cheers, ...ch.huh, ch.bye.walkedOff, ch.bye.timedOut]) add(ch.fallback, t);
    for (const t of smallTalkLines().guests[ch.id] ?? []) add(ch.fallback, t);
  }
}

// Stand-ins (Kokoro) for the reactions and your replies, until the ElevenLabs takes are in.
{
  const { GUESTS } = await import('../src/client/cast');
  const { STAFF, CREW_VOICES } = await import('../src/client/speech');
  const stand: Record<string, string> = { ...Object.fromEntries(GUESTS.map((g) => [g.id, g.fallback])), ...STAFF, crew_rocco: CREW_VOICES[0], crew_dev: CREW_VOICES[1], crew_mikey: CREW_VOICES[2] };
  for (const [who, set] of Object.entries(REACTIONS)) if (stand[who]) for (const list of Object.values(set)) for (const t of list) add(stand[who], t);
  for (const [k, pv] of Object.entries(PLAYER_STANDIN)) for (const t of replyLabels()) add(pv, t), void k;
}

const lines = [...out.values()].sort((x, y) => (x.voice + x.id).localeCompare(y.voice + y.id));
writeFileSync('tools/voices/lines.json', JSON.stringify(lines, null, 1));
const per: Record<string, number> = {};
for (const l of lines) per[l.voice] = (per[l.voice] ?? 0) + 1;
console.log(lines.length, 'lines;', JSON.stringify(per));

// ---------------------------------------------------------------------------
// ElevenLabs cast (tools/voices/render_eleven.py): each character's own lines,
// plus every shared line they can be heard saying, in their voice.
// ---------------------------------------------------------------------------
{
  const { GUESTS, elVoice } = await import('../src/client/cast');
  // Priority 1: what makes them characters (their own lines, staff, crew); 2: shared small talk.
  const el = new Map<string, { id: string; voice: string; text: string; p: number }>();
  const addEl = (voice: string, text: string, p = 1) => {
    text = text.trim();
    if (!text) return;
    const id = lineId(voice, text);
    const k = voice + '/' + id;
    el.set(k, { id, voice, text, p: Math.min(p, el.get(k)?.p ?? p) });
  };
  const walkEl = (n: Node, voice: string, p = 1) => {
    const texts = typeof n.say === 'function' ? ctxs.map((c) => (n.say as (c: Ctx) => string)(c)) : [n.say];
    texts.forEach((t) => addEl(voice, t, p));
    for (const r of n.replies ?? []) {
      if (r.end) addEl(voice, r.end, p);
      if (r.next) walkEl(r.next, voice, p);
    }
  };
  for (const ch of GUESTS) {
    const v = elVoice(ch.id);
    for (const n of ch.openers) walkEl(n, v);
    for (const t of [...ch.quips, ...ch.win, ...ch.cheers, ...ch.huh, ch.bye.walkedOff, ch.bye.timedOut]) addEl(v, t);
    // Off-script answers (smalltalk.ts): their name, how they're doing, "ask the staff".
    for (const t of smallTalkLines().guests[ch.id] ?? []) addEl(v, t);
    // Shared lines anyone might say.
    for (const list of [EXCHANGES, PASSING]) for (const ex of list) for (const [, t] of ex.turns) addEl(v, t, 2);
    for (const t of [...WIN_REACTIONS, ...CHEERS_LINES, ...HUH_LINES, CONVO_BYE.walkedOff, CONVO_BYE.timedOut]) addEl(v, t, 2);
    for (const aud of ['guest', 'pool', 'bar'] as const) for (const n of OPENERS[aud]) walkEl(n, v, 2);
  }
  const staff: Record<string, (v: string) => void> = {
    bartender: (v) => {
      for (const t of Object.values(BARTENDER_LINES)) addEl(v, t);
      for (const k of DRINKS) addEl(v, orderLine(k.name, k.prep as Prep));
      for (const n of OPENERS.bartender) walkEl(n, v);
    },
    croupier: (v) => {
      addEl(v, CROUPIER_LINES.noMore);
      addEl(v, CROUPIER_LINES.place);
      for (let p = 0; p < 38; p++) addEl(v, rouletteCall(pocketLabel(p), pocketColor(p)));
      for (const n of OPENERS['dealer-roulette']) walkEl(n, v);
    },
    stickman: (v) => {
      for (let a = 1; a <= 6; a++)
        for (let b = 1; b <= 6; b++)
          for (const point of [null, 4, 5, 6, 8, 9, 10]) {
            const t = a + b;
            addEl(v, stickCall([a, b], point === null, point, point !== null && t === 7, point !== null && t === point));
          }
      for (const n of OPENERS['dealer-craps']) walkEl(n, v);
    },
    dealer: (v) => {
      for (const n of OPENERS.croupier) walkEl(n, v);
    },
    waiter: (v) => {
      for (const n of OPENERS.waiter) walkEl(n, v);
    },
    // The cocktail waitresses (the same lines in a woman's voice).
    waitress: (v) => {
      for (const n of OPENERS.waiter) walkEl(n, v);
    },
  };
  for (const [k, fn] of Object.entries(staff)) {
    const v = elVoice(k);
    fn(v);
    // Off-script answers (smalltalk.ts): their name, how they're doing, directions.
    for (const t of smallTalkLines().staff[k as keyof ReturnType<typeof smallTalkLines>['staff']] ?? []) addEl(v, t);
    for (const t of [CONVO_BYE.walkedOff, CONVO_BYE.timedOut, ...HUH_LINES]) addEl(v, t);
  }
  // The Promenade's staff: no small talk, just their own lines.
  for (const [who, list] of Object.entries(promenadeLines())) for (const t of list) addEl(elVoice(who), t);
  for (const name of ['rocco', 'dev', 'mikey']) {
    const v = elVoice('crew_' + name);
    for (const list of Object.values(CREW_LINES)) for (const t of list) addEl(v, t);
    for (const t of CREW_DAP_LINES) addEl(v, t);
    for (const t of TIPSY_LINES) addEl(v, t);
  }
  // Getting physical: pushed, punched, doused, hit (priority 1: these are the loud moments).
  for (const [who, set] of Object.entries(REACTIONS)) for (const list of Object.values(set)) for (const t of list) addEl(elVoice(who), t);
  // Your own replies, out loud.
  for (const pv of Object.values(PLAYER_VOICES)) for (const t of replyLabels()) addEl(elVoice(pv), t);
  // The pool party (party/concertlines.ts; scripts/concert-lines.json): the show's lines in each regular's voice,
  // NIXIE VALE between her sets, the crew out there, and your replies in those conversations.
  {
    const { CONCERT, CREW_PARTY, MC, NIXIE, concertLinesOf, concertReplyLabels, nixieLines } = await import('../src/client/party/concertlines');
    // The DJ on the mic, calling her a minute before her set.
    addEl(elVoice(MC.id), MC.call);
    for (const [id, set] of Object.entries(CONCERT)) for (const t of concertLinesOf(set)) addEl(elVoice(id), t);
    for (const t of nixieLines()) addEl(elVoice(NIXIE.id), t);
    for (const name of ['rocco', 'dev', 'mikey']) for (const list of Object.values(CREW_PARTY)) for (const t of list) addEl(elVoice('crew_' + name), t);
    for (const pv of Object.values(PLAYER_VOICES)) for (const t of concertReplyLabels()) addEl(elVoice(pv), t);
  }
  const elLines = [...el.values()].sort((x, y) => (x.voice + x.id).localeCompare(y.voice + y.id));
  writeFileSync('tools/voices/eleven-lines.json', JSON.stringify(elLines, null, 1));
  const chars = elLines.reduce((n, l) => n + l.text.length, 0);
  const p1 = elLines.filter((l) => l.p === 1);
  console.log('ElevenLabs:', elLines.length, 'lines,', chars, 'characters; priority 1:', p1.length, 'lines,', p1.reduce((n, l) => n + l.text.length, 0), 'characters');
}
