/**
 * What the Promenade's staff say: a cook at each food counter and the Lago
 * Luxe clerk. Every line is a fixed string (one per dish where a dish is
 * named), so each can be recorded ahead of time: scripts/voice-lines.ts lists
 * them for ElevenLabs (el_cook_pizza, ...) and their Kokoro stand-ins (STAFF
 * in speech.ts). Pure (no DOM, no three), like speech.ts.
 *
 * Square-bracket tags like [laughs] are ElevenLabs v3 audio tags: performed,
 * not spoken (and stripped for captions).
 */

import { COUNTERS, type MerchKey } from './areas/promenadeplan';

export type CookId = 'pizza' | 'burger' | 'noodles' | 'gelato';
/** Voice cast ids (SPEAKERS in cast.ts, STAFF in speech.ts). */
export type PromSpeaker = 'cook_pizza' | 'cook_burger' | 'cook_noodles' | 'cook_gelato' | 'clerk';

export const cookSpeaker = (counter: string): PromSpeaker => `cook_${counter}` as PromSpeaker;

export interface CookLines {
  hello: string[];
  /** By dish name (the counter's menu item names, exactly). */
  order: Record<string, string[]>;
  ready: Record<string, string[]>;
  busy: string[];
  broke: string[];
}

export const COOK_LINES: Record<CookId, CookLines> = {
  // Tony: a New York pizza man, big-hearted, proud of his oven.
  pizza: {
    hello: ["Hey, how you doin'? Slices are hot, oven's hotter.", 'Step right up! Best slice west of Brooklyn.', "[laughs] Look at you, you look hungry. What'll it be?"],
    order: {
      'Slice of pepperoni': ["One pepperoni, comin' right up!", "Pepperoni? Now we're talkin'. Gimme a minute.", 'You got it, one slice of pepperoni. Into the oven.'],
      'Slice of margherita': ["Margherita! A classic. Comin' up.", 'One margherita, fresh basil and everything.', 'You got it. One slice of margherita, into the oven.'],
    },
    ready: {
      'Slice of pepperoni': ["Here ya go, one pepperoni. Careful, it's hot!", 'Pepperoni, hot outta the oven. Enjoy!', 'Order up! Your pepperoni slice.'],
      'Slice of margherita': ["Here ya go, one margherita. Careful, it's hot!", 'Margherita, hot outta the oven. Enjoy!', 'Order up! Your margherita slice.'],
    },
    busy: ["Whoa, one at a time, boss. Yours is in the oven.", 'Easy, easy! I got yours in already.'],
    broke: ["Ah, sorry pal. Chips only, and you're a little short."],
  },
  // Duke: a loud Texas grill man who hollers his orders.
  burger: {
    hello: ["Howdy! Grill's hot. What're we havin'?", 'Hungry? You came to the right place, friend.', "[laughs] Step on up! Nothin' fixes a bad night like a burger."],
    order: {
      'Lago double cheeseburger': ["One Lago double, comin' right up!", "The double cheeseburger? Atta way! Give me a few.", 'Double cheese, double patty. You got it.'],
      'Single smash burger': ['One smash burger, on the grill!', "Single smash? Good call. Comin' right up.", 'Smash burger, you got it. Give me a minute.'],
    },
    ready: {
      'Lago double cheeseburger': ['Order up! One Lago double cheeseburger.', "Here's your double. Napkins are on me!", 'Lago double, hot off the grill. Enjoy!'],
      'Single smash burger': ['Order up! One smash burger.', 'Smash burger, hot off the grill!', 'There ya go, one single smash. Dig in!'],
    },
    busy: ['Hold your horses, I got yours on the grill!', "One at a time, partner. Yours is comin'."],
    broke: ["Sorry, friend. Chips only, and you're comin' up short."],
  },
  // Mei: a calm, precise wok master with a dry wit.
  noodles: {
    hello: ['Welcome to Golden Dragon. Noodles are pulled fresh.', "Hi there. Hungry? The wok's ready when you are.", "Evening. Take your time. The menu's short and it's all good."],
    order: {
      'Garlic chili noodles': ['Garlic chili noodles. Good choice. Give me a minute.', 'One garlic chili. Hope you like it spicy.', 'Garlic chili noodles, coming right up.'],
      'Sesame beef noodles': ['Sesame beef noodles, coming up.', 'One sesame beef. My favourite.', 'Sesame beef. Into the wok it goes.'],
    },
    ready: {
      'Garlic chili noodles': ['Here you go. Garlic chili noodles. Careful, they bite back.', 'Garlic chili noodles, hot from the wok.', 'Order up. Your garlic chili noodles.'],
      'Sesame beef noodles': ['Here you go. Sesame beef noodles. Enjoy.', 'Sesame beef noodles, hot from the wok.', 'Order up. Your sesame beef noodles.'],
    },
    busy: ['One wok, one order. Yours is next.', 'Patience. Good noodles take a minute.'],
    broke: ["Sorry. Chips only, and you're a little short."],
  },
  // Lucia: sunny, sweet and playful, from Bologna.
  gelato: {
    hello: ['Ciao! Gelato, sorbetto, espresso. What makes you happy?', 'Buonasera! Come, come, have a look.', 'Ciao! Something sweet tonight?'],
    order: {
      'Pistachio gelato cone': ['Pistachio! Bravo, the best one.', 'One pistachio cone, subito!', 'Pistachio, my favourite. Un momento.'],
      'Stracciatella gelato cone': ['Stracciatella! Molto bene. One moment.', 'One stracciatella cone, coming up!', 'Ah, stracciatella. A classic. Subito!'],
    },
    ready: {
      'Pistachio gelato cone': ['Ecco! One pistachio cone. Enjoy!', 'Here you go, pistachio. Eat it before it melts!', 'Pistachio gelato, just for you. Buon appetito!'],
      'Stracciatella gelato cone': ['Ecco! One stracciatella cone. Enjoy!', 'Here you go, stracciatella. Eat it before it melts!', 'Stracciatella, just for you. Buon appetito!'],
    },
    busy: ["Piano, piano! One at a time, yours is coming.", "Un momento! I'm still scooping yours."],
    broke: ["Oh, mi dispiace. Chips only, and you're a little short."],
  },
};

/** Simone, the Lago Luxe clerk: polished, elegant, quietly witty. */
export const CLERK_LINES: { hello: string[]; paid: Record<MerchKey, string[]>; broke: string[]; shoplift: string[] } = {
  hello: ['Welcome to Lago Luxe. Try anything on.', 'Good evening. Have a look around, take your time.', 'Welcome in. Sunglasses are on the front table, hats by the mirror.'],
  paid: {
    sunglasses: ['Thank you. Enjoy the sunglasses.', 'All yours. The sunglasses look great on you.', 'Wonderful choice. Very Riviera.'],
    hat: ['Thank you. Enjoy the fedora.', 'All yours. The fedora looks great on you.', 'A fedora. Very Rat Pack. Have a great night.'],
    plush: ['Thank you. Lucky will take good care of you.', "All yours. He's very soft, isn't he?", 'Wonderful choice. Have a great night.'],
    diceset: ['Thank you. Enjoy the dice.', 'All yours. May they roll sevens.', 'Wonderful choice. Have a great night.'],
  },
  broke: ["I'm sorry, chips only, and you're a little short."],
  shoplift: ["Excuse me? You'll want to pay for that at the counter.", 'Ahem. The register is right here, darling.'],
};

/** Every line each Promenade speaker can say (for recording, and for tests). */
export function promenadeLines(): Record<PromSpeaker, string[]> {
  const out = {} as Record<PromSpeaker, string[]>;
  for (const c of COUNTERS) {
    const l = COOK_LINES[c.id as CookId];
    const all = [...l.hello, ...l.busy, ...l.broke];
    for (const it of c.items) all.push(...(l.order[it.name] ?? []), ...(l.ready[it.name] ?? []));
    out[cookSpeaker(c.id)] = [...new Set(all)];
  }
  out.clerk = [...new Set([...CLERK_LINES.hello, ...Object.values(CLERK_LINES.paid).flat(), ...CLERK_LINES.broke, ...CLERK_LINES.shoplift])];
  return out;
}
