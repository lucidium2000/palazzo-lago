/**
 * Who says what, in which voice. Every spoken line in the game is recorded
 * ahead of time with a neural voice (Kokoro, see tools/voices) and played as
 * 3D sound from the person saying it. This module is pure (no DOM, no three)
 * so the line list for recording (scripts/voice-lines.ts) and the game agree.
 */

/** Recorded voice ids (Kokoro v1.0 voice names). */
export type VoiceId = string;

/** Staff and your crew each have their own voice. */
export const STAFF = {
  croupier: 'bm_george', // roulette
  stickman: 'am_puck', // craps
  dealer: 'af_nicole', // blackjack, poker and other dealers (Grace)
  bartender: 'af_bella',
  waiter: 'bm_fable',
  waitress: 'af_river',
  security: 'am_adam',
} as const;

export const CREW_VOICES: VoiceId[] = ['am_michael', 'am_fenrir', 'am_eric'];

/** Guests' voices (each guest keeps one, chosen from their seed). */
export const GUEST_MALE: VoiceId[] = ['am_liam', 'am_onyx', 'am_echo', 'bm_daniel'];
export const GUEST_FEMALE: VoiceId[] = ['af_heart', 'af_nicole', 'af_sarah', 'af_jessica', 'af_kore', 'bf_emma', 'af_nova', 'af_river'];
export const GUEST_ALL = [...GUEST_MALE, ...GUEST_FEMALE];

/** Speaking pace per voice when recording (1 = normal). */
export const PACE: Record<VoiceId, number> = { am_puck: 1.08, am_fenrir: 1.04, am_eric: 1.05, am_michael: 1.03, bm_george: 0.96 };

export function guestVoice(seed: number, female: boolean): VoiceId {
  const pool = female ? GUEST_FEMALE : GUEST_MALE;
  return pool[Math.floor(Math.abs(seed) * 9973) % pool.length];
}

/** Ambient scenes: each speaking part of an exchange has one fixed voice per gender. */
export function sceneVoice(exchange: number, part: number, female: boolean): VoiceId {
  return female ? GUEST_FEMALE[(exchange * 3 + part * 5) % GUEST_FEMALE.length] : GUEST_MALE[(exchange + part * 3) % GUEST_MALE.length];
}

/** The id of a recorded line: FNV-1a over the UTF-8 bytes of `voice|text`, 8 hex digits. */
export function lineId(voice: VoiceId, text: string): string {
  const bytes = new TextEncoder().encode(`${voice}|${text.trim()}`);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type CrewMoment =
  | 'arrive'
  | 'idle'
  | 'spin'
  | 'win'
  | 'bigwin'
  | 'loss'
  | 'bigloss'
  | 'streak'
  | 'bonus'
  | 'order'
  | 'round'
  | 'tip'
  | 'terrace'
  | 'finale'
  | 'goal'
  | 'legend';

export const CREW_LINES: Record<CrewMoment, string[]> = {
  arrive: ["Alright boys. Vegas, baby!", "I've got a good feeling about tonight.", "First stop: the tables. Let's make some money."],
  idle: [
    "This place is unreal.",
    "We should hit the bar at some point.",
    "Have you seen the fountains? We gotta go out on the terrace.",
    "Roulette's calling your name, I'm telling you.",
    "Red is due. I can feel it.",
    "That piano guy is smooth.",
    "Somebody's gonna hit big tonight. Might as well be us.",
    "Look at this ceiling. Who even builds this?",
  ],
  spin: ["Come on, come on!", "Big money, big money!", "Here we go!", "Let it ride!"],
  win: ["There it is!", "Nice!", "Ka-ching!", "That's what I'm talking about!", "Easy money."],
  bigwin: ["Let's gooo!", "No way! No way!", "Drinks are on you tonight!", "You're a legend!", "Somebody call my mom!"],
  loss: ["Shake it off.", "Run it back.", "That's alright, next one.", "Ouch.", "The house got lucky."],
  bigloss: ["Oof. Brutal.", "That one hurt to watch.", "Okay, deep breath. We go again."],
  streak: ["He's heating up!", "Don't touch him, he's on fire!", "Three in a row! Who is this guy?"],
  bonus: ["Bonus round!", "Here we go, here we go!", "Oh it's happening!"],
  order: ["Make it a double!", "Ooh, fancy.", "Cheers to that."],
  round: ["Now that's a friend!", "Salute!", "To the best night ever!", "Cheers, brother!"],
  tip: ["Classy move.", "Big tipper over here.", "He's gonna play our song now."],
  terrace: ["Now that's a view.", "Wait for the finale. Trust me.", "This is the best spot in Vegas."],
  finale: ["Whoa!", "That's insane!", "Okay, that was worth the trip."],
  goal: ["Checking boxes tonight!", "Look at us go."],
  legend: ["Legendary night, boys. Legendary.", "Nobody's gonna believe this back home."],
};

/** Your crew, a few drinks in. */
export const TIPSY_LINES = ['', 'Easy there, champ!', "Somebody's feeling good tonight!", 'Okay, water next. I mean it.'];

/** A guest clinking glasses with you. */
export const CHEERS_LINES = ['Cheers!', 'Salute!', 'To Vegas!', 'Bottoms up!'];

/** Conversation ends that aren't in a tree. */
export const CONVO_BYE = { walkedOff: 'Alright, enjoy your night!', timedOut: 'No worries. Have a good one!' };

/** When someone didn't catch what you said (voice replies): they roll with it. */
export const HUH_LINES = [
  "Ha! I'll take that as a yes.",
  "Sorry, it's so loud in here! Anyway.",
  "I have no idea what you just said, but I like your energy.",
  "You know what? Same.",
  "Say that again? Actually, never mind. Good luck out there!",
  "Right on. Right on.",
  "Ha, totally. Vegas, am I right?",
  "Sure thing, my friend.",
];

export const BARTENDER_LINES = {
  hello: 'Evening! What can I get you?',
  regular: 'Good to see you again, my friend. The usual, or something new?',
  regularShort: 'My friend! What are we having?',
  tip1: 'Hey, appreciate you! Next one is on the fast track.',
  tipMore: 'You are a gentleman. Thank you!',
};

export type Prep = 'shake' | 'stir' | 'pour' | 'tap';
export function orderLine(name: string, prep: Prep): string {
  return {
    shake: `One ${name}, shaken. Coming up.`,
    stir: `${name}, coming right up.`,
    pour: `${name}. Good choice.`,
    tap: `${name}, fresh off the tap.`,
  }[prep];
}

export const CROUPIER_LINES = { noMore: 'No more bets.', place: 'Place your bets, please.' };

/** The roulette call, e.g. "Seventeen, black." (numbers as words read best). */
export function rouletteCall(label: string, color: 'red' | 'black' | 'green'): string {
  const n = label === '00' ? 'Double zero' : label === '0' ? 'Zero' : numberWords(Number(label));
  return `${n}${color === 'green' ? '' : ', ' + color}.`;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
export function numberWords(n: number): string {
  const w = n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return w.charAt(0).toUpperCase() + w.slice(1);
}
