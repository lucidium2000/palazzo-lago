/**
 * Fight mode's new lines (src/client/fight/fightlines.ts, and the slap lines
 * in reactlines.ts SLAPPED) for the ElevenLabs session: every line, who says
 * it (voice id, character, gender), when, and its take's id
 * (public/voices/<voice>/<id>.mp3, the id the game looks up: speech.ts lineId).
 * Lines already recorded in that voice are left out.
 *
 *   npx tsx scripts/fight-lines.ts      # writes scripts/fight-lines.json
 *
 * (scripts/voice-lines.ts lists them in tools/voices/eleven-lines.json too.)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { GUESTS, SPEAKERS, elVoice } from '../src/client/cast';
import { SLAPPED } from '../src/client/reactlines';
import { lineId } from '../src/client/speech';
import {
  ANNOUNCER_CONTEXT, ANNOUNCER_ID, CREW_FIGHT, CREW_FIGHT_CONTEXT, CROWD_FIGHT, CROWD_FIGHT_CONTEXT, FIGHTER_LINES, FIGHT_MOMENTS, MOMENT_CONTEXT, PLAYER_FIGHT,
  PLAYER_FIGHT_CONTEXT, announcerLines, type CrewFight,
} from '../src/client/fight/fightlines';

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
const speaker = (id: string) => SPEAKERS.find((s) => s.id === id)!;

// The regulars who fight you (and security).
for (const [id, set] of Object.entries(FIGHTER_LINES)) {
  const g = GUESTS.find((c) => c.id === id);
  const sp = g ? { name: g.name, gender: g.gender, hint: g.voiceHint } : { name: speaker(id).name, gender: 'male' as const, hint: speaker(id).voiceHint };
  for (const m of FIGHT_MOMENTS) for (const t of set[m]) add(elVoice(id), sp.name, sp.gender, `fight mode: ${MOMENT_CONTEXT[m]}`, t, sp.hint);
}
// The regulars watching a fight.
for (const [id, list] of Object.entries(CROWD_FIGHT)) {
  const g = GUESTS.find((c) => c.id === id)!;
  for (const t of list) add(elVoice(id), g.name, g.gender, `fight mode: ${CROWD_FIGHT_CONTEXT}`, t, g.voiceHint);
}
// Slapped across the face (reactlines.ts SLAPPED).
for (const [id, list] of Object.entries(SLAPPED)) {
  const g = GUESTS.find((c) => c.id === id);
  const sp = g ? { name: g.name, gender: g.gender, hint: g.voiceHint } : { name: speaker(id).name, gender: 'male' as const, hint: speaker(id).voiceHint };
  for (const t of list) add(elVoice(id), sp.name, sp.gender, 'slapped across the face by the player (an open hand): shocked, outraged, holding their cheek', t, sp.hint);
}
// Your crew around your fight.
for (const [id, set] of Object.entries(CREW_FIGHT)) {
  const sp = speaker(id);
  for (const k of Object.keys(set) as CrewFight[]) for (const t of set[k]) add(elVoice(id), sp.name, 'male', `fight mode: ${CREW_FIGHT_CONTEXT[k]}`, t, sp.voiceHint);
}
// You.
for (const [id, set] of Object.entries(PLAYER_FIGHT)) {
  const sp = speaker(id);
  for (const m of FIGHT_MOMENTS) for (const t of set[m]) add(elVoice(id), 'You', id === 'you_f' ? 'female' : 'male', `fight mode: ${PLAYER_FIGHT_CONTEXT[m]}`, t, sp.voiceHint);
}
// The announcer.
{
  const sp = speaker(ANNOUNCER_ID);
  for (const t of announcerLines()) add(elVoice(ANNOUNCER_ID), sp.name, 'male', ANNOUNCER_CONTEXT, t, sp.voiceHint);
}

const lines = [...out.values()].sort((x, y) => (x.voice + x.context + x.text).localeCompare(y.voice + y.context + y.text));
const texts = new Set(lines.map((l) => l.text));
const voicesUsed = [...new Set(lines.map((l) => l.voice))];
writeFileSync(
  'scripts/fight-lines.json',
  JSON.stringify(
    {
      about:
        "Fight mode's new lines to record with ElevenLabs (eleven_v3: [tags] are performance directions, not words): the regulars who fight you, the regulars watching, your crew, your own voice, the slap reactions, and fight mode's own original announcer. Each take goes to public/voices/<voice>/<id>.mp3 and into public/voices/index.json (tools/voices/render_eleven.py does both; scripts/voice-lines.ts lists these in tools/voices/eleven-lines.json). The game picks a take up as soon as it is in the index; until then these lines are captions with wordless effort sounds (fighters) or synthesized stings (the announcer), never browser TTS.",
      newVoice: { el_announcer: { character: speaker(ANNOUNCER_ID).name, gender: 'male', brief: speaker(ANNOUNCER_ID).voiceHint, note: 'Not cast yet: el_announcer is in tools/voices/eleven-cast.json with its brief and no voice_id; run render_eleven.py --cast to pick one.' } },
      takes: lines.length,
      uniqueLines: texts.size,
      voices: voicesUsed.length,
      lines,
    },
    null,
    1,
  ) + '\n',
);
console.log(`${lines.length} takes (${texts.size} unique lines) in ${voicesUsed.length} voices -> scripts/fight-lines.json`);
