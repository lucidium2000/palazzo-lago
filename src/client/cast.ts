import type { Node } from './dialogueLines';

/**
 * The regulars: a cast of characters with personalities. Every guest in the
 * casino is played by one of them (by their seed), so the same person always
 * sounds and talks the same way. Each has their own voice (recorded with
 * ElevenLabs, see tools/voices/render_eleven.py; `voiceHint` is the casting
 * brief used to pick it) and their own lines: how they open a conversation,
 * what they say as you walk by, how they react, how they take their leave.
 * Square-bracket tags like [laughs] are ElevenLabs v3 audio tags: performed,
 * not spoken (and stripped for captions).
 */

export interface Character {
  id: string;
  name: string;
  gender: 'male' | 'female';
  /** Who they are (also the ElevenLabs direction for their performance). */
  bio: string;
  /** Casting brief for picking an ElevenLabs voice. */
  voiceHint: string;
  /** Kokoro voice used until their ElevenLabs voice is recorded. */
  fallback: string;
  openers: Node[];
  /** Said as you pass by. */
  quips: string[];
  /** Someone near them won big. */
  win: string[];
  /** Clinking glasses with you. */
  cheers: string[];
  /** Didn't catch what you said. */
  huh: string[];
  bye: { walkedOff: string; timedOut: string };
}

export const GUESTS: Character[] = [
  {
    id: 'vinnie',
    name: 'Vinnie',
    gender: 'male',
    bio: 'A loud, generous high roller from New Jersey in a shiny suit. Calls everyone "my friend", tips big, tells stories with his hands.',
    voiceHint: 'middle-aged man, New Jersey / New York Italian-American accent, raspy, big and warm, fast talker',
    fallback: 'am_onyx',
    openers: [
      {
        say: "Hey! My friend! [laughs] You look like a winner. You feeling lucky tonight?",
        replies: [
          { label: 'Yeah, feeling lucky', end: "That's what I'm talking about! Go get 'em, champ." },
          { label: 'Not really', next: { say: "Ehh, luck's a lady, she comes around. You want a tip? Craps table. Trust me.", replies: [{ label: 'Thanks!', end: 'Anytime, my friend. Anytime.' }, { label: "I'll pass", end: "Your loss! [laughs] I'm kidding. Have a good one." }] } },
        ],
      },
      {
        say: 'You play craps? Because I just made the point four times in a row. Four! You believe that?',
        replies: [
          { label: 'No way!', end: "Swear on my mother. [laughs] Drinks are on me later." },
          { label: 'Sure you did', end: "Ha! A skeptic. I like you. Come watch next time." },
        ],
      },
    ],
    quips: ["My friend! Good to see ya.", "Big night tonight, I can feel it in my bones.", "[whistles] Look at this place, huh?"],
    win: ["Oh, now THAT'S how you do it!", "Somebody's eating steak tonight!"],
    cheers: ['Salute, my friend!', 'To you, champ!'],
    huh: ["Ha! Whatever you said, I agree.", "What? It's loud in here. Anyway, you're a good guy."],
    bye: { walkedOff: 'Alright, alright. Go get rich!', timedOut: "Eh, you're a quiet one. I like that. Take care." },
  },
  {
    id: 'dale',
    name: 'Dale',
    gender: 'male',
    bio: 'A laid-back Texas oilman in a cowboy hat and boots. Slow drawl, folksy sayings, never in a hurry, quietly a very good poker player.',
    voiceHint: 'older man, thick Texas drawl, deep, slow and relaxed, warm and folksy',
    fallback: 'am_echo',
    openers: [
      {
        say: "Well, howdy. You look about as lost as I was my first time here. Need a hand findin' somethin'?",
        replies: [
          { label: 'Yes, please', end: "Bar's thataway, tables are yonder, pool's out back. Can't miss it." },
          { label: "No, I'm good", end: "Alright then. Holler if you need anything, partner." },
        ],
      },
      {
        say: "You ever play poker? Real poker, not that machine nonsense.",
        replies: [
          { label: 'All the time', end: "Well, then we oughta play sometime. Bring your wallet. [chuckles]" },
          { label: 'Never', end: "Lesson one: never bet more than your boots are worth." },
        ],
      },
    ],
    quips: ["Evenin'.", "Hot enough outside to fry an egg on the sidewalk.", "Don't rush, son. Vegas'll wait."],
    win: ["Well, I'll be.", "Now ain't that somethin'."],
    cheers: ["Here's mud in your eye.", 'Cheers, partner.'],
    huh: ["[chuckles] Didn't quite catch that, but I reckon you're right.", "Come again? Ah, never mind. Ain't important."],
    bye: { walkedOff: "Y'all take care now.", timedOut: 'Alright. Happy trails.' },
  },
  {
    id: 'marcus',
    name: 'Marcus',
    gender: 'male',
    bio: 'The best man of a bachelor party from Atlanta. Smooth, funny, hyping everyone up, laughs easily, slightly losing track of the groom.',
    voiceHint: 'young adult man, Atlanta / Southern American, smooth, energetic, charismatic, laughs a lot',
    fallback: 'am_liam',
    openers: [
      {
        say: "Yo! Have you seen a guy in a sash that says 'groom'? [laughs] I lost my groom. Again.",
        replies: [
          { label: 'Yeah, by the bar', end: "Of course he's at the bar! Appreciate you, man." },
          { label: 'No, sorry', end: "It's fine, it's fine. He always turns up. Usually at the buffet." },
        ],
      },
      {
        say: 'You wanna join the bachelor party? Pool, then the club. You look like you know how to have a good time.',
        replies: [
          { label: "I'm in", end: "Let's gooo! Meet us at the pool in twenty!" },
          { label: 'Maybe later', end: 'Bet. Offer stands all night, my guy.' },
        ],
      },
    ],
    quips: ["Ayyy, what's good!", "Tonight's gonna be legendary, I'm calling it.", '[laughs] This place is wild.'],
    win: ["Let's gooo! That's a W!", 'Okay, okay, I see you!'],
    cheers: ['To the groom! Wherever he is!', 'Cheers, my guy!'],
    huh: ["[laughs] Say less. I got you.", "Bro, I can't hear a thing in here. But yeah!"],
    bye: { walkedOff: 'Catch you later, man!', timedOut: 'All good. Go have fun!' },
  },
  {
    id: 'reggie',
    name: 'Reginald',
    gender: 'male',
    bio: 'A posh London banker on a work trip that turned into a holiday. Dry wit, impeccable manners, mildly baffled by everything being so big.',
    voiceHint: 'middle-aged man, upper-class British (RP) accent, dry, witty, measured, refined',
    fallback: 'bm_daniel',
    openers: [
      {
        say: 'Forgive me. Is it always this... enthusiastic in here? In London we gamble quietly and feel guilty about it.',
        replies: [
          { label: 'Always', end: 'Splendid. I shall endeavour to keep up.' },
          { label: "No, it's a big night", end: "Ah. Then I've picked my night rather well." },
        ],
      },
      {
        say: 'Would you happen to know if the roulette here is single zero? I refuse to play double zero on principle.',
        replies: [
          { label: "It's double zero", end: 'Barbaric. I shall play anyway, naturally.' },
          { label: 'No idea', end: "Quite right. One shouldn't know these things on holiday." },
        ],
      },
    ],
    quips: ['Good evening.', 'Remarkable ceiling. Utterly unnecessary. I love it.', 'One more drink and I shall be unbearable.'],
    win: ['Oh, well played.', 'I say. Bravo.'],
    cheers: ['Your very good health.', 'Cheers, old sport.'],
    huh: ["I beg your pardon? Ah. Never mind, I'm sure you're right.", '[chuckles] I shall take that as a yes.'],
    bye: { walkedOff: 'Do enjoy your evening.', timedOut: 'Quite. Well, carry on.' },
  },
  {
    id: 'tommy',
    name: 'Tommy',
    gender: 'male',
    bio: 'A nervous first-timer accountant from Ohio. Knows all the odds, is terrified of actually betting, sweetly overexcited about everything.',
    voiceHint: 'young man, Midwestern American, nasal, nervous and fast, earnest, a bit nerdy',
    fallback: 'am_liam',
    openers: [
      {
        say: "Hi! Sorry. Do you know the house edge on double zero roulette? It's five point two six percent. I looked it up. Is that bad?",
        replies: [
          { label: 'Yes, pretty bad', end: "I knew it. I'm playing anyway. Wish me luck!" },
          { label: "No, you'll be fine", end: "Okay. Okay! You're right. Yolo, right? Is that what people say?" },
        ],
      },
      {
        say: "This is my first time in Vegas. Is it okay that I'm a little terrified?",
        replies: [
          { label: 'Totally okay', end: "Phew. Okay. I'm gonna try the slots. Small steps." },
          { label: 'Just have fun', end: 'Fun. Yes. I can do fun. I think.' },
        ],
      },
    ],
    quips: ['Oh! Hi. Sorry. Hi.', 'The odds on that are terrible, by the way.', "I've spent forty dollars. Forty!"],
    win: ['Oh my gosh! Oh my gosh!', "Statistically that shouldn't happen! Amazing!"],
    cheers: ['Cheers! Oh, careful, my glass is full.', 'To... to fun!'],
    huh: ["Sorry, what? I'm so sorry. Yes. Probably yes.", "Ha, sorry, I didn't catch that. It's so loud!"],
    bye: { walkedOff: 'Okay! Bye! Good luck!', timedOut: 'Oh. Okay. Nice talking! Sort of!' },
  },
  {
    id: 'sal',
    name: 'Sal',
    gender: 'male',
    bio: 'A retired lounge singer who has played every room in Vegas since the seventies. Nostalgic, charming, hums between sentences, everyone knows him.',
    voiceHint: 'elderly man, classic Vegas crooner, smooth deep baritone, warm, theatrical, old New York',
    fallback: 'am_onyx',
    openers: [
      {
        say: "[hums] Ah, you should've seen this town in seventy-six, kid. You want to hear a story?",
        replies: [
          { label: 'Sure', end: "Sinatra once borrowed my lighter and never gave it back. [laughs] Best night of my life." },
          { label: 'Maybe later', end: "Later, sure. I'll be here. I'm always here." },
        ],
      },
      {
        say: 'You like the piano player? I taught him that song. Well, I sang it at him once.',
        replies: [
          { label: "He's great", end: "He's alright. He's got time to get great." },
          { label: 'Not really', end: "[laughs] An honest one. Don't tell him I agree." },
        ],
      },
    ],
    quips: ['[hums softly] Fly me to the moon...', 'Good evening, good evening.', "They don't build them like this anymore. Oh wait, they just did."],
    win: ["Now that's music!", 'Ring-a-ding-ding!'],
    cheers: ['Salud, kid.', 'To the good old days. And these ones.'],
    huh: ["[laughs] My ears ain't what they used to be. Sure, sure.", "What's that? Eh, beautiful."],
    bye: { walkedOff: 'Stay classy, kid.', timedOut: 'Alright, off you go. Break a leg.' },
  },
];

GUESTS.push(
  {
    id: 'margo',
    name: 'Margo',
    gender: 'female',
    bio: 'A retired Vegas showgirl, still glamorous in sequins. Sassy, sharp, has seen everything twice, gives blunt advice with a wink.',
    voiceHint: 'older woman, husky smoky voice, sassy, confident, theatrical, classic American',
    fallback: 'af_nicole',
    openers: [
      {
        say: "Honey, I danced on that stage for twenty years. You want some advice about this town?",
        replies: [
          { label: 'Yes, please', end: 'Never chase your losses, never trust a man in a fedora, and always tip the bartender. [laughs]' },
          { label: "No thanks", end: 'Suit yourself, sugar. Learn the hard way like the rest of us.' },
        ],
      },
      {
        say: "Is that what you're wearing tonight? [laughs] Kidding. Mostly. Having fun?",
        replies: [
          { label: 'Having a blast', end: "Good. That's the only rule that matters." },
          { label: 'Not yet', end: 'Then get a drink and get on the dance floor, darling.' },
        ],
      },
    ],
    quips: ['Evening, gorgeous.', "In my day, this was all sawdust and cigarettes.", '[laughs] Look at you.'],
    win: ['Now THAT is a showstopper!', 'Encore, darling!'],
    cheers: ['Cheers, darling.', 'To bad decisions and good stories.'],
    huh: ["Sweetheart, I didn't hear a word. Yes, yes, lovely.", "[laughs] Speak up, honey, I'm not getting any younger."],
    bye: { walkedOff: 'Ta-ta, darling.', timedOut: 'Mm. The strong silent type. Bye now.' },
  },
  {
    id: 'priya',
    name: 'Priya',
    gender: 'female',
    bio: "A tech executive from San Francisco on a girls' trip. Fast, competitive, treats blackjack like a spreadsheet, secretly loves the cheesy slots.",
    voiceHint: 'woman in her thirties, Californian American, crisp, fast, confident, playful',
    fallback: 'af_sarah',
    openers: [
      {
        say: "Okay, quick question. Do you hit on sixteen against a ten? My friends say no. My friends are wrong.",
        replies: [
          { label: 'Yes, hit', end: 'Thank you! Basic strategy! Someone gets it.' },
          { label: 'No, stand', end: "Wow. Okay. You and my friends can have a group chat." },
        ],
      },
      {
        say: "Don't tell anyone, but I've spent an hour on the pig slot. The pigs! Have you played it?",
        replies: [
          { label: 'Love the pigs', end: "Right?! The blue one when it gets fat? Chef's kiss." },
          { label: 'Not yet', end: "Go. Now. Thank me later." },
        ],
      },
    ],
    quips: ['Hey!', "I'm up three hundred and I'm not stopping.", 'Has anyone seen my friends? They were just here.'],
    win: ['Yes! Called it!', "Data doesn't lie!"],
    cheers: ['Cheers! To winning.', "To girls' trips!"],
    huh: ["Sorry, didn't catch that. I'll assume you agree with me.", '[laughs] Totally. Wait, what?'],
    bye: { walkedOff: 'Okay, bye! Good luck!', timedOut: "Cool, cool. I'll be at the tables." },
  },
  {
    id: 'destiny',
    name: 'Destiny',
    gender: 'female',
    bio: 'A bubbly bride-to-be on her bachelorette weekend, wearing a veil and a sash. Tipsy, loving, hugs strangers, squeals a lot.',
    voiceHint: 'young woman, bubbly, high energy, giggly, Southern Californian, a little tipsy',
    fallback: 'af_nova',
    openers: [
      {
        say: "Oh my gosh, hi! I'm getting MARRIED! [giggles] Are you having the best night?",
        replies: [
          { label: 'Congratulations!', end: "Thank you! Oh my gosh, you're so nice. Come to the wedding!" },
          { label: 'Best night ever', end: 'Me too! Woo! Okay, I need another drink.' },
        ],
      },
      {
        say: 'Will you take a picture of us? [giggles] Wait, where did my girls go?',
        replies: [
          { label: 'Sure', end: "Yay! Okay, I'll find them. Don't move! Actually, move. Have fun!" },
          { label: 'Sorry, no', end: "Totally fine! I love you anyway! Bye!" },
        ],
      },
    ],
    quips: ['Woo! Bachelorette!', '[giggles] Hi!', "I'm getting married! Did I mention that?"],
    win: ['Oh my gosh, YES!', 'Woooo!'],
    cheers: ['Cheers to me! I mean, to us!', 'To love! [giggles]'],
    huh: ['[giggles] I have no idea what you said but I love it.', "Yes! Wait. What? Yes!"],
    bye: { walkedOff: 'Byeee! Love you!', timedOut: 'Okay! Bye, new friend!' },
  },
  {
    id: 'eleanor',
    name: 'Eleanor',
    gender: 'female',
    bio: 'An elegant British widow in pearls who plays very high stakes baccarat and never shows her cards. Warm but formidable, wickedly dry.',
    voiceHint: 'older woman, refined British accent, elegant, calm, low, dry humour',
    fallback: 'bf_emma',
    openers: [
      {
        say: 'Good evening. Do you play cards, or do you merely watch them, like most people?',
        replies: [
          { label: 'I play', end: 'Then I hope we never sit at the same table. For your sake, dear.' },
          { label: 'I just watch', end: 'Wise. Watching is free. Playing is educational.' },
        ],
      },
      {
        say: "My late husband loved this place. He was terrible at blackjack. Absolutely hopeless. Would you like a drink?",
        replies: [
          { label: "I'd love one", end: "Tell the bartender it's on Eleanor. She knows." },
          { label: "I'm alright", end: 'Of course. Sobriety suits some people.' },
        ],
      },
    ],
    quips: ['Good evening.', 'Mm. Rather crowded tonight.', 'Never let them see you count, dear.'],
    win: ['How marvellous.', 'Well done, you.'],
    cheers: ['Your health, dear.', 'Chin chin.'],
    huh: ["I'm sorry, dear, I didn't quite hear. Never mind.", 'Hm. Yes, I expect so.'],
    bye: { walkedOff: 'Goodnight, dear.', timedOut: 'Well. Do enjoy yourself.' },
  },
  {
    id: 'kayla',
    name: 'Kayla',
    gender: 'female',
    bio: 'A night-shift nurse from Minnesota on her first real vacation in years. Warm, friendly, laughs at her own jokes, a little starstruck by everything.',
    voiceHint: 'woman in her thirties, Minnesota / Midwestern accent, warm, friendly, cheerful',
    fallback: 'af_heart',
    openers: [
      {
        say: "Oh, hi there! Sorry, I'm just looking at the ceiling. Isn't it the prettiest thing you ever saw?",
        replies: [
          { label: "It's beautiful", end: "Right? I'm gonna take like a hundred pictures. Don't judge me." },
          { label: "It's alright", end: "Oh, you're tough to impress! [laughs] Well, I love it." },
        ],
      },
      {
        say: "Can I ask you something? Is it okay to sit at a slot machine if I'm not playing? My feet are killing me.",
        replies: [
          { label: 'Sure, go ahead', end: "Oh, thank goodness. Ya, these shoes were a mistake." },
          { label: 'Better not', end: 'Oh, okay! The bar it is then. Thanks, hon!' },
        ],
      },
    ],
    quips: ['Oh, hi there!', "Oh my gosh, it's so warm in here, ya?", "I could get used to this."],
    win: ['Oh, holy cow!', 'Oh, good for you!'],
    cheers: ['Cheers, hon!', 'Oh, cheers! This is fun!'],
    huh: ["Oh, sorry, hon, it's so noisy! You betcha.", '[laughs] Ya, ya, sure.'],
    bye: { walkedOff: 'Okay, bye now! Have fun!', timedOut: 'Oh, okay! Take care, hon.' },
  },
  {
    id: 'rosa',
    name: 'Rosa',
    gender: 'female',
    bio: 'A cool, unreadable card shark from Miami in a black dress. Speaks little, notices everything, amused by amateurs, never in a hurry.',
    voiceHint: 'woman in her forties, slight Cuban-American Miami accent, low, cool, slow, mysterious',
    fallback: 'af_kore',
    openers: [
      {
        say: "You've been watching the tables. Counting?",
        replies: [
          { label: 'No', end: "Mm. That's what they all say." },
          { label: 'Maybe', end: '[laughs softly] Then keep your face still, cariño.' },
        ],
      },
      {
        say: 'Do you want to know the secret to winning here?',
        replies: [
          { label: 'Yes', end: "Leave while you're ahead. Nobody ever does." },
          { label: 'No', end: 'Smart. Secrets are expensive.' },
        ],
      },
    ],
    quips: ['Mm.', 'Interesting night.', "They're watching the cameras. Smile."],
    win: ['Not bad.', 'Hm. Lucky.'],
    cheers: ['Salud.', 'To quiet winnings.'],
    huh: ['[laughs softly] Say it again. No? Fine.', "I didn't hear you. That's okay."],
    bye: { walkedOff: 'Ciao.', timedOut: 'Mm. See you around.' },
  },
);

/** Staff and your crew: their voices (their lines are elsewhere: speech.ts). */
export const SPEAKERS: { id: string; name: string; bio: string; voiceHint: string }[] = [
  { id: 'bartender', name: 'Gia', bio: "Bar Lago's bartender: warm, quick, witty, remembers every regular's order.", voiceHint: 'woman in her thirties, warm, smooth, friendly, slight Italian-American New York' },
  { id: 'croupier', name: 'Laurent', bio: 'The roulette croupier: elegant, precise, a touch of Monte Carlo.', voiceHint: 'man, refined, calm, slight French accent, crisp announcer' },
  { id: 'stickman', name: 'Benny', bio: 'The craps stickman: fast-talking, rhythmic, pure hype.', voiceHint: 'man, Brooklyn accent, energetic, fast, rhythmic, carnival barker' },
  { id: 'dealer', name: 'Grace', bio: 'Blackjack dealer: friendly, professional, unflappable.', voiceHint: 'woman, professional, friendly, clear American' },
  { id: 'security', name: 'Security', bio: 'The casino security guards: big, calm, firm, unimpressed.', voiceHint: 'man in his forties, deep, calm, firm, authoritative, American, a bouncer' },
  { id: 'waitress', name: 'Mia', bio: 'Cocktail waitress: bright, quick, warm, a little flirty with the regulars.', voiceHint: 'woman in her twenties, bright, warm, friendly, upbeat American' },
  { id: 'waiter', name: 'Theo', bio: 'Cocktail server: polished, charming, discreet.', voiceHint: 'young man, polished, charming, soft British or neutral American' },
  { id: 'crew_rocco', name: 'Rocco', bio: "Your crew's loud leader: big laugh, big heart, always hyping you up.", voiceHint: 'man in his thirties, loud, booming, Boston or Chicago, big laugh' },
  { id: 'crew_dev', name: 'Dev', bio: "Your crew's joker: sarcastic, quick, roasts everyone with love.", voiceHint: 'man in his thirties, dry sarcastic humour, quick, American' },
  { id: 'you_m', name: 'You', bio: 'The player (a man): your replies, out loud.', voiceHint: 'man in his thirties, natural, friendly, relaxed, neutral American' },
  { id: 'you_f', name: 'You', bio: 'The player (a woman): your replies, out loud.', voiceHint: 'woman in her thirties, natural, friendly, relaxed, neutral American' },
  { id: 'crew_mikey', name: 'Mikey', bio: "Your crew's lightweight: sweet, excitable, two drinks in and already emotional.", voiceHint: 'young man, sweet, excitable, a little high-pitched, goofy, American' },
  // The Promenade's staff (their lines: promenadelines.ts).
  { id: 'cook_pizza', name: 'Tony', bio: "Forno Lago's pizza man: a big-hearted New Yorker, proud of his oven, calls everyone pal.", voiceHint: 'man in his fifties, New York Italian-American, warm, gravelly, big-hearted, a pizzeria owner' },
  { id: 'cook_burger', name: 'Duke', bio: 'High Roller Burgers\' grill man: loud, cheerful, hollers his orders across the food court.', voiceHint: 'man in his forties, loud, booming, Texas drawl, cheerful short-order cook energy' },
  { id: 'cook_noodles', name: 'Mei', bio: 'Golden Dragon Noodle Bar\'s wok master: calm, precise, dry wit, warm underneath.', voiceHint: 'woman in her thirties, calm, precise, low and dry, quietly funny, neutral American' },
  { id: 'cook_gelato', name: 'Lucia', bio: 'Dolce Vita Gelateria\'s gelataia from Bologna: sunny, sweet, playful, sprinkles in Italian.', voiceHint: 'young woman, bright, sunny, sweet, playful, light Italian accent' },
  { id: 'clerk', name: 'Simone', bio: 'The Lago Luxe boutique\'s clerk: polished, elegant, quietly witty, never pushy.', voiceHint: 'woman in her thirties, polished, elegant, smooth and low, quietly witty, refined American' },
  // The pool stage's headliner, between her sets (her lines: party/concertlines.ts).
  { id: 'nixie', name: 'Nixie Vale', bio: "NIXIE VALE, the pool stage's headliner: an electropop star in her late twenties (an original character). Warm, quick, a little breathless between sets, all about the show and the people who came to see it.", voiceHint: 'young woman in her late twenties, bright, warm, a little husky, energetic pop singer, neutral American' },
];

/** The character a guest is played by (by gender, then their seed). */
export function characterFor(seed: number, female: boolean): Character {
  const pool = GUESTS.filter((c) => c.gender === (female ? 'female' : 'male'));
  return pool[Math.floor(Math.abs(seed) * 7919) % pool.length];
}

/** Their recorded voice id (ElevenLabs), e.g. "el_vinnie". */
export const elVoice = (id: string) => `el_${id}`;

/** Text without performance tags (for captions and bubbles). */
export const spoken = (t: string) => t.replace(/\s*\[[^\]]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
