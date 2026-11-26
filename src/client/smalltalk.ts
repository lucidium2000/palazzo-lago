/**
 * What people say when you talk to them off-script (voice replies,
 * understand.ts): their name, how they're doing, where things are, and how they
 * take an insult. Pure data, like dialogueLines.ts.
 *
 * NEW lines (names, how they're doing, directions) are listed by
 * scripts/voice-lines.ts for recording; until a line is recorded it is a
 * caption only (dialogue.ts), never the browser's robot voice. Where a line
 * that's already recorded fits, it's used first (`*_RECORDED`): a guest
 * answering "where's the bathroom?" with "Past the slots, on the left." from
 * the ambient scenes, or their own "I'm up three hundred and I'm not stopping."
 * for "how are you doing?". Insults get lines that are already recorded (the
 * 'pushed' / 'hit' reactions in reactlines.ts that suit words as well as
 * shoves).
 */

import type { Place } from './understand';

export interface SmallTalk {
  /** Asked their name. */
  name: string;
  /** Asked how they're doing (or whether they're winning). */
  how: string;
  /** Asked where something is (guests don't know their way around). */
  where: string;
}

/** The regulars (cast.ts ids), in their own voice. */
export const GUEST_TALK: Record<string, SmallTalk> = {
  vinnie: {
    name: "Vinnie! Everybody knows Vinnie. From Jersey, my friend.",
    how: "Me? I'm up, I'm down, I'm havin' the time of my life! [laughs]",
    where: "Ah, I'm turned around myself, my friend. Ask somebody in a uniform.",
  },
  dale: {
    name: "Name's Dale. Pleasure's all mine.",
    how: "Can't complain. Up a little, and the whiskey's cold.",
    where: "Couldn't tell ya, partner. I just follow my boots. Ask the staff.",
  },
  marcus: {
    name: "Marcus! Best man, professional hype guy. [laughs]",
    how: "Man, I'm great. Lost the groom, found the buffet. That's a win.",
    where: "No clue, bro. I can't even find my groom. Ask the staff, they know everything.",
  },
  reggie: {
    name: "Reginald. Reggie, once I've had a drink or two.",
    how: "Rather well, thank you. Up forty dollars, which I'm told is pathetic here.",
    where: "I haven't the foggiest, I'm afraid. One of the staff will know.",
  },
  tommy: {
    name: "Tommy! Uh, Thomas. Tommy. From Ohio. Hi.",
    how: "Good! Nervous. I'm down twelve dollars, but I'm learning so much!",
    where: "Oh, gosh, I don't know. I've been lost for an hour. Maybe ask a dealer?",
  },
  sal: {
    name: "Sal. I sang in every lounge on this Strip, kid.",
    how: "Still kickin', kid. Every night in this town is a good night.",
    where: "They moved everything since my day. Ask the young lady at the bar.",
  },
  margo: {
    name: "Margo, honey. They used to put it in lights.",
    how: "Darling, I'm fabulous. I'm always fabulous.",
    where: "Sugar, I don't give directions. Ask someone in a uniform.",
  },
  priya: {
    name: "Priya. Nice to meet you. Quickly, though, I've got a hot table.",
    how: "Up, ahead of my friends, and I have the data to prove it.",
    where: "No idea, honestly. Ask the staff, or just follow the noise.",
  },
  destiny: {
    name: "I'm Destiny! The bride! [giggles] Did I mention I'm getting married?",
    how: "The best! Oh my gosh, I'm so happy. And a little tipsy.",
    where: "Oh my gosh, I have no idea where anything is! [giggles] Ask somebody sober.",
  },
  eleanor: {
    name: "Eleanor. Delighted, I'm sure.",
    how: "Very well, thank you, dear. Winning, as it happens. I usually am.",
    where: "I never notice where things are, dear. The staff will help you.",
  },
  kayla: {
    name: "Oh, I'm Kayla! From Duluth. Nice to meet ya!",
    how: "Oh, I'm having the best time, hon. Down a little, but who cares!",
    where: "Oh, gosh, I'm lost too, hon! Maybe ask one of the staff?",
  },
  rosa: {
    name: "Rosa.",
    how: "Winning. Quietly.",
    where: "Ask the staff. I only know where the cards are.",
  },
};

/** Lines a regular already has recorded that also answer "how are you doing?". */
export const HOW_RECORDED: Record<string, string[]> = {
  vinnie: ['Big night tonight, I can feel it in my bones.'],
  marcus: ["Tonight's gonna be legendary, I'm calling it."],
  reggie: ['One more drink and I shall be unbearable.'],
  tommy: ["I've spent forty dollars. Forty!"],
  priya: ["I'm up three hundred and I'm not stopping."],
  destiny: ["I'm getting married! Did I mention that?"],
  eleanor: ['Mm. Rather crowded tonight.'],
  kayla: ['I could get used to this.'],
  rosa: ['Interesting night.'],
};

/** Ambient-scene lines every guest voice has recorded that give real directions. */
export const WHERE_RECORDED: Partial<Record<Place, string>> = {
  bathroom: 'Past the slots, on the left.',
  pool: 'Through the hotel lobby, past the elevators.',
  cashier: 'Over by the entrance. Cashing out?',
};

/** Staff with conversations (speech.ts STAFF / cast.ts SPEAKERS ids). */
export type StaffId = 'bartender' | 'waiter' | 'waitress' | 'croupier' | 'stickman' | 'dealer';

export const STAFF_TALK: Record<StaffId, Omit<SmallTalk, 'where'>> = {
  bartender: { name: "I'm Gia. Remember it, and I'll remember your order.", how: 'Busy, but I love it. Nights like this fly by.' },
  waiter: { name: 'Theo, at your service.', how: 'Very well, thank you. A lively night.' },
  waitress: { name: "I'm Mia! Holler if you need anything.", how: 'Running around like crazy, but good! Thanks for asking.' },
  croupier: { name: 'Laurent, monsieur. At your service.', how: 'Very well, merci. The wheel is kind tonight. To some.' },
  stickman: { name: 'Benny! Benny on the stick! Hot hands, hot dice!', how: "Hot table, hot night, baby! Couldn't be better!" },
  dealer: { name: "I'm Grace. Welcome to my table.", how: 'Doing great, thanks. The cards are behaving. Mostly.' },
};

/** Directions, from anyone who works here. `unknown`: they didn't catch where. */
export const STAFF_WHERE: Record<Place | 'unknown', string> = {
  bar: 'Bar Lago is along the west wall, by the poker room. Follow the piano.',
  craps: 'Craps is at the back of the pit, past roulette. Just follow the shouting.',
  roulette: "Roulette's in the pit, on the bar side. Listen for the wheel.",
  blackjack: 'The blackjack tables are right in the middle of the pit.',
  poker: 'The poker room is through the west wall, past Bar Lago.',
  slots: "The slots are on the east side of the floor. You'll hear them.",
  pool: "The pool's through the hotel lobby, past the elevators, then out the doors.",
  bathroom: 'Restrooms are past the slots, on the left.',
  elevator: 'The elevators are in the hotel lobby, just east of the casino floor.',
  arcade: "The arcade's on the Promenade. Take the elevators in the hotel lobby.",
  food: 'For food, take the elevators to the Promenade. Pizza, burgers, noodles and gelato.',
  cashier: 'The cashier is over by the entrance.',
  terrace: 'The terrace is at the far end of the floor. Best view of the fountains.',
  shop: 'Lago Luxe is on the Promenade, by the food court. Take the elevators.',
  unknown: "Sorry, where to? The bar, the tables, the pool, the Promenade? Just ask.",
};

/**
 * Said back to an insult: recorded reactions (reactlines.ts) that suit rude
 * words, not only a shove. `kind`: which REACTIONS set the line is in.
 */
export const RUDE_COMEBACKS: Record<string, { kind: 'pushed' | 'hit'; text: string }[]> = {
  vinnie: [{ kind: 'pushed', text: '[grunts] Watch it, pal.' }, { kind: 'pushed', text: 'Whoa, whoa! Easy, my friend!' }],
  dale: [{ kind: 'pushed', text: '[grunts] Easy now.' }, { kind: 'pushed', text: 'Mind yourself, son.' }],
  marcus: [{ kind: 'pushed', text: 'Do you mind?' }, { kind: 'hit', text: '[annoyed] Seriously? Grow up.' }],
  reggie: [{ kind: 'pushed', text: 'I say! Do mind yourself.' }, { kind: 'hit', text: '[indignant] Utterly uncivilised.' }],
  tommy: [{ kind: 'pushed', text: 'Whoa! Easy, bro!' }, { kind: 'pushed', text: 'Dude! Watch it!' }],
  sal: [{ kind: 'pushed', text: 'You got a problem?' }, { kind: 'pushed', text: 'Watch it.' }],
  margo: [{ kind: 'pushed', text: 'Hey! Who taught you manners?' }, { kind: 'pushed', text: 'Oh! Excuse you, honey.' }],
  priya: [{ kind: 'pushed', text: 'Um, can you not?' }, { kind: 'hit', text: '[annoyed] Wow. Real mature.' }],
  destiny: [{ kind: 'pushed', text: 'Um, excuse you?' }],
  eleanor: [{ kind: 'pushed', text: 'Young man, please!' }, { kind: 'hit', text: '[disapproving] Such behaviour in a place like this.' }],
  kayla: [{ kind: 'pushed', text: '[annoyed] Ugh, seriously?' }, { kind: 'hit', text: '[annoyed] Ugh. Grow up.' }],
  rosa: [{ kind: 'pushed', text: 'Excuse me!' }, { kind: 'hit', text: '[annoyed] Que maleducado.' }],
  bartender: [{ kind: 'hit', text: "[annoyed] Seriously? I'm working here." }],
  waiter: [{ kind: 'pushed', text: 'Oh! Pardon me.' }],
  waitress: [{ kind: 'pushed', text: 'Easy there, sweetie.' }],
  croupier: [{ kind: 'pushed', text: 'Pardon, monsieur.' }],
  stickman: [{ kind: 'pushed', text: 'Whoa! Easy, champ!' }],
  dealer: [{ kind: 'pushed', text: '[calm] Easy there.' }],
};

/** Every new line, by speaker id (for recording: scripts/voice-lines.ts). */
export function smallTalkLines(): { guests: Record<string, string[]>; staff: Record<StaffId, string[]> } {
  const guests: Record<string, string[]> = {};
  for (const [id, t] of Object.entries(GUEST_TALK)) guests[id] = [t.name, t.how, t.where];
  const where = Object.values(STAFF_WHERE);
  const staff = {} as Record<StaffId, string[]>;
  for (const [id, t] of Object.entries(STAFF_TALK) as [StaffId, (typeof STAFF_TALK)[StaffId]][]) staff[id] = [t.name, t.how, ...where];
  return { guests, staff };
}
