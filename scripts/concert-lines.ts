/**
 * The pool party's new lines (src/client/party/concertlines.ts) for the
 * ElevenLabs session: every line, who says it (their voice id, character and
 * gender), and when, with its take's id (public/voices/<voice>/<id>.mp3, the
 * same id the game looks up: speech.ts lineId). Lines already recorded in that
 * voice are left out.
 *
 *   npx tsx scripts/concert-lines.ts      # writes scripts/concert-lines.json
 *
 * (scripts/voice-lines.ts lists them for tools/voices/render_eleven.py too.)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { GUESTS, SPEAKERS, elVoice } from '../src/client/cast';
import { CONCERT, CREW_PARTY, NIXIE, concertReplyLabels, treeLines, type ConcertSet } from '../src/client/party/concertlines';
import { PLAYER_VOICES, replyLabels } from '../src/client/reactlines';
import { lineId } from '../src/client/speech';

interface Out {
  id: string;
  voice: string;
  character: string;
  gender: 'male' | 'female';
  context: string;
  text: string;
  brief: string;
}

const recorded: Record<string, Record<string, number>> = existsSync('public/voices/index.json') ? JSON.parse(readFileSync('public/voices/index.json', 'utf8')).voices : {};
const out = new Map<string, Out>();
const add = (voice: string, character: string, gender: 'male' | 'female', context: string, text: string, brief: string) => {
  text = text.trim();
  if (!text) return;
  const id = lineId(voice, text);
  if (recorded[voice]?.[id] !== undefined) return;
  const k = voice + '/' + id;
  if (!out.has(k)) out.set(k, { id, voice, character, gender, context, text, brief });
};

for (const ch of GUESTS) {
  const s: ConcertSet | undefined = CONCERT[ch.id];
  if (!s) continue;
  const v = elVoice(ch.id);
  const a = (ctx: string, list: string[]) => list.forEach((t) => add(v, ch.name, ch.gender, ctx, t, ch.voiceHint));
  a('before her set: hype, is she on yet', s.soon);
  a('during her set: shouting and cheering over loud live music', s.live);
  a('between songs / after her set: buzzing', s.after);
  a("the DJ's stretch: the DJ, the lights, the pool", s.dj);
  a('to the player, walking past at the concert', s.quips);
  a('conversation with the player at the concert (over loud music)', [...treeLines(s.opener).say, s.how, s.cheers, s.huh, s.bye.walkedOff, s.bye.timedOut]);
  a('pushed by the player in the crowd: annoyed, trying to see the stage', s.react.pushed);
  a('drink thrown on them at the concert: outraged', s.react.doused);
  a('hit by something thrown at the concert: angry', s.react.hit);
  a('punched at the concert: a loud yell of pain', s.react.punched);
}

{
  const sp = SPEAKERS.find((x) => x.id === NIXIE.id)!;
  const v = elVoice(NIXIE.id);
  const a = (ctx: string, list: string[]) => list.forEach((t) => add(v, NIXIE.name, NIXIE.gender, ctx, t, sp.voiceHint));
  a('the headliner between her sets, greeting a fan backstage-side of the stage (never while performing)', NIXIE.greet);
  a('the headliner chatting with a fan between sets', [...NIXIE.openers.flatMap((n) => treeLines(n).say), NIXIE.how, NIXIE.cheers, NIXIE.huh, NIXIE.bye.walkedOff, NIXIE.bye.timedOut]);
  a('the headliner bumped / soaked / hit between sets: startled, still friendly', Object.values(NIXIE.react).flat());
}

for (const name of ['rocco', 'dev', 'mikey']) {
  const sp = SPEAKERS.find((x) => x.id === 'crew_' + name)!;
  for (const [phase, list] of Object.entries(CREW_PARTY)) for (const t of list) add(elVoice('crew_' + name), sp.name, 'male', `your crew at the pool concert (${phase})`, t, sp.voiceHint);
}

// Your own replies in the party's conversations (said out loud in your voice; the new ones only).
{
  const known = new Set(replyLabels());
  for (const [g, pv] of Object.entries(PLAYER_VOICES) as ['male' | 'female', string][]) {
    const sp = SPEAKERS.find((x) => x.id === pv)!;
    for (const t of concertReplyLabels()) if (!known.has(t)) add(elVoice(pv), 'You', g, "the player's reply in a conversation at the concert", t, sp.voiceHint);
  }
}

const lines = [...out.values()].sort((x, y) => (x.voice + x.context + x.text).localeCompare(y.voice + y.context + y.text));
const texts = new Set(lines.map((l) => l.text));
const voicesUsed = [...new Set(lines.map((l) => l.voice))];
writeFileSync(
  'scripts/concert-lines.json',
  JSON.stringify(
    {
      about:
        'New pool-party / concert lines to record with ElevenLabs (eleven_v3: [tags] are performance directions, not words). Each take goes to public/voices/<voice>/<id>.mp3 and into public/voices/index.json (tools/voices/render_eleven.py does both; scripts/voice-lines.ts lists these in tools/voices/eleven-lines.json). The game picks a take up as soon as it is in the index; until then these lines are bubbles and wordless whoops, never browser TTS.',
      newVoice: { el_nixie: { character: NIXIE.name, gender: NIXIE.gender, brief: NIXIE.voiceHint, note: 'Not cast yet: run render_eleven.py --cast (or add el_nixie to tools/voices/eleven-cast.json by hand).' } },
      takes: lines.length,
      uniqueLines: texts.size,
      voices: voicesUsed.length,
      lines,
    },
    null,
    1,
  ) + '\n',
);
console.log(`${lines.length} takes (${texts.size} unique lines) in ${voicesUsed.length} voices -> scripts/concert-lines.json`);
