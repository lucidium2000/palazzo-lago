/**
 * What people say when you get physical with them: bumped or pushed, punched,
 * doused with a drink, or hit by something you threw. One set per speaker (the
 * regulars, the staff and your crew), in their own voice and personality.
 * Lines carry ElevenLabs v3 performance tags ([gasps], [angry], ...); the
 * stand-in voice reads only the words.
 */

import { GUESTS } from './cast';
import { OPENERS } from './dialogueLines';

export type ReactKind = 'pushed' | 'punched' | 'doused' | 'hit';

export type ReactLines = Record<ReactKind, string[]>;

export const REACTIONS: Record<string, ReactLines> = {
  vinnie: {
    pushed: ['Whoa, whoa! Easy, my friend!', "Hey! What's the rush?", '[grunts] Watch it, pal.', "Ay! You're gonna knock me over!"],
    punched: ['[shouting] OW! What the hell?!', '[groans] Oh! Oh, you did NOT just do that!', "[yelling] OUCH! You know who I am?!"],
    doused: ["[shocked] Are you kiddin' me?! This is Italian silk!", '[angry] Oh, come on! The suit! THE SUIT!', "You did not just throw a drink on me. You did NOT."],
    hit: ["[angry] Hey! Who threw that?!", "Ow! What are you, a pitcher for the Mets?", "[shouting] You throw things at me? Me?!"],
  },
  dale: {
    pushed: ['Whoa there, partner.', '[grunts] Easy now.', "Hey now, ain't no stampede in here.", 'Mind yourself, son.'],
    punched: ['[groans loudly] OW! Well, I\'ll be... that smarts!', "[shouting] OUCH! Now that ain't neighbourly!", '[pained] Ow! You best not do that again, son.'],
    doused: ["[sighs] Well, that's a perfectly good whiskey wasted.", "[annoyed] Now what in the Sam Hill was that for?", "Son, in Texas, that'll get you thrown out of a bar."],
    hit: ["[angry] Hey! Who's throwin' things?", "Ow! You got a decent arm, I'll give ya that. Now quit it.", "[annoyed] Lord have mercy. Quit chuckin' stuff."],
  },
  marcus: {
    pushed: ['Whoa, excuse you.', '[annoyed] Watch where you\'re going, man.', 'Hey, personal space.', 'Do you mind?'],
    punched: ["[shouting] OW! Are you serious?!", '[groans] Oh, that is assault, man! That is assault!', '[yelling] OUCH! My face! I have a meeting tomorrow!'],
    doused: ['[outraged] This shirt is four hundred dollars!', "[angry] Unbelievable. Absolutely unbelievable.", "You're paying for my dry cleaning. All of it."],
    hit: ['[angry] Did you just throw that at me?', 'Ow! What is wrong with you?', "[annoyed] Seriously? Grow up."],
  },
  reggie: {
    pushed: ['I say! Do mind yourself.', '[huffs] Steady on, old chap.', 'Good heavens, watch where you tread.', 'Pardon me!'],
    punched: ["[shouting] OW! Good LORD! You absolute brute!", '[groans] Oh! Oh, my jaw! This is an outrage!', "[yelling] OUCH! I shall be speaking to the manager!"],
    doused: ['[appalled] Well! I have never been so insulted!', "[indignant] You've soaked my blazer, you savage.", 'How dare you. How DARE you, sir.'],
    hit: ['[angry] I beg your pardon! Was that thrown at me?', 'Ow! Hooligan!', "[indignant] Utterly uncivilised."],
  },
  tommy: {
    pushed: ["Whoa! Easy, bro!", "[laughs] Hey, what's up with the shoving?", "Dude! Watch it!", "Hey, hey, I'm walking here!"],
    punched: ["[shouting] OW! Bro! What the heck?!", "[groans] Ohhh, dude. Why?! Why would you do that?", "[yelling] OUCH! Not cool, man! NOT cool!"],
    doused: ["[shocked] DUDE! I just got this shirt!", "[angry] Bro, are you serious right now?!", "[groans] Oh man, now I smell like a frat house."],
    hit: ["[angry] Yo! Who threw that?!", "Ow! Dude, that hurt!", "[annoyed] Bro, quit throwing stuff!"],
  },
  sal: {
    pushed: ['[grumbles] Hey. Easy.', 'Watch it.', "You got a problem?", '[grunts] Mind the elbows.'],
    punched: ["[roaring] OW! You got a death wish, kid?!", '[groans] Ohh. Oh, that was a mistake. Big mistake.', "[yelling] OUCH! You know how many guys tried that?!"],
    doused: ['[cold, angry] You just made a very bad decision.', "[growls] This is a forty-year-old suit, kid.", "Now we got a problem, you and me."],
    hit: ['[angry] You throwin\' things at me?', 'Ow. You\'re lucky I\'m in a good mood.', "[menacing] Do that again. I dare ya."],
  },
  margo: {
    pushed: ['Oh! Excuse you, honey.', '[gasps] Watch it, sweetheart!', "Hey! Who taught you manners?", 'Easy, darling!'],
    punched: ["[shrieks] OW! Did you just HIT me?!", '[yelling] OUCH! Security! SECURITY!', "[groans] Ohh! You little... OW!"],
    doused: ['[shrieks] My HAIR! Do you know how long this took?!', "[outraged] This is vintage, you animal!", "[angry] Oh, you are going to regret that, sweetie."],
    hit: ['[angry] Excuse me?! Did you throw that at me?', 'Ow! Who raised you?', "[annoyed] Honey, aim somewhere else."],
  },
  priya: {
    pushed: ['Oh! Excuse me.', '[surprised] Hey, careful!', "Um, can you not?", 'Whoa, watch it.'],
    punched: ["[shouting] OW! What is WRONG with you?!", "[yelling] OUCH! I'm calling security!", '[groans] Oh my god, that actually hurt!'],
    doused: ["[gasps] Are you serious?! My dress!", "[angry] Oh my god. Oh my GOD.", "That's it. I'm done. You're unbelievable."],
    hit: ['[angry] Did you just throw something at me?', 'Ow! Seriously?!', "[annoyed] Wow. Real mature."],
  },
  destiny: {
    pushed: ["Whoa! Watch it, babe!", "[laughs] Hey! No pushing!", "Um, excuse you?", 'Easy there!'],
    punched: ["[screams] OW! Oh my god, you HIT me!", "[yelling] OUCH! What is your problem?!", '[crying out] OW! That really hurt, you jerk!'],
    doused: ["[shrieks] NO! My outfit! I'm posting about this!", "[angry] Oh my god, I'm literally soaked!", "[outraged] Are you kidding me right now?!"],
    hit: ['[angry] Hey! Who threw that?!', 'Ow! Rude!', "[annoyed] Seriously? Not the face!"],
  },
  eleanor: {
    pushed: ['Oh my! Careful, dear.', '[gasps] Goodness! Do watch yourself.', 'Young man, please!', 'Mind your step, dear.'],
    punched: ["[cries out] OW! Oh, you horrible person!", "[yelling] OUCH! Somebody help!", '[gasps in pain] Oh! At my age!'],
    doused: ['[appalled] Well, I never! In all my years!', "[indignant] My good pearls! Shame on you.", "Your mother would be ashamed of you, dear."],
    hit: ['[startled] Oh! Who threw that?', 'Ow! Really, now!', "[disapproving] Such behaviour in a place like this."],
  },
  kayla: {
    pushed: ["Hey! Watch it!", "[annoyed] Ugh, seriously?", "Excuse me?!", 'Whoa, easy!'],
    punched: ["[screaming] OW! Are you INSANE?!", "[yelling] OUCH! I'm calling the cops!", "[groans] Oh my god, ow, ow, OW!"],
    doused: ["[shrieks] EW! It's in my hair!", "[furious] You did NOT just do that!", "[angry] Oh, you're so dead. You're so dead."],
    hit: ["[angry] Who threw that?! Was it you?", "Ow! What the heck?!", "[annoyed] Ugh. Grow up."],
  },
  rosa: {
    pushed: ['Ay! Cuidado!', '[annoyed] Hey, careful, careful.', 'Whoa, slow down, mijo.', 'Excuse me!'],
    punched: ["[shouting] AY! OW! Que te pasa?!", '[yelling] OUCH! Are you crazy?!', "[groans] Ay, Dios mio, that hurts!"],
    doused: ['[outraged] Ay, no! My dress! Que asco!', "[angry] You think that's funny? Huh?", "Oh, you're lucky my sister isn't here."],
    hit: ["[angry] Ay! Who threw that?", 'Ow! Mira, stop it!', "[annoyed] Que maleducado."],
  },
  bartender: {
    pushed: ["Whoa, careful, hon!", "[laughs] Easy, I've got a tray here!", "Hey, mind the bar, sweetie."],
    punched: ["[shouting] OW! Okay, you're cut off!", "[yelling] OUCH! Security, now!", "[groans] Oh, you did not just hit the bartender."],
    doused: ["[sighs] Wow. Wasting my good work on me?", "[annoyed] Okay. That's your last drink tonight.", "Real classy. Real classy."],
    hit: ["[angry] Hey! No throwing at the bar!", "Ow! You're cut off, pal.", "[annoyed] Seriously? I'm working here."],
  },
  waiter: {
    pushed: ['Oh! Pardon me.', '[startled] Careful, sir, careful.', 'Mind the tray, please!'],
    punched: ["[cries out] OW! Sir! That is entirely uncalled for!", "[yelling] OUCH! Security!", '[groans] Oh! Oh, my nose!'],
    doused: ["[composed, annoyed] I'll... just fetch a towel, then.", "[sighs] That will not be reflected well in your tip, I imagine.", "Charming. Truly."],
    hit: ['[startled] Oh! Who threw that?', 'Ow! Please, sir!', "[annoyed] We do not throw things in the Palazzo."],
  },
  croupier: {
    pushed: ['Pardon, monsieur.', '[stiffly] Please, keep your distance from the wheel.', 'Careful, s\'il vous plait.'],
    punched: ["[shouting] OW! Mon dieu! Security!", "[yelling] OUCH! This is a disgrace!", '[groans] Ah! You will be escorted out, monsieur!'],
    doused: ['[icy] Charming. Truly charming.', "[indignant] On my good waistcoat? Quelle horreur.", 'I will pretend that did not happen. Once.'],
    hit: ['[annoyed] Please! Not at the table!', 'Ow! Monsieur, really!', "[cold] Do that again and you will play elsewhere."],
  },
  stickman: {
    pushed: ['Whoa! Easy, champ!', '[laughs] Hey, no shoving at the rail!', 'Careful, careful!'],
    punched: ["[shouting] OW! Hey! What're you, nuts?!", "[yelling] OUCH! Pit boss! PIT BOSS!", '[groans] Ohh, that\'s a seven-out for you, pal!'],
    doused: ["[annoyed] Aw, come on! Not on the felt!", "[angry] You're payin' for this shirt, buddy!", "Real smooth. Real smooth."],
    hit: ['[angry] Hey! Throw the dice, not the glassware!', 'Ow! Watch it!', "[annoyed] Wrong thing to throw, champ."],
  },
  dealer: {
    pushed: ['Oh! Careful, please.', '[calm] Easy there.', 'Please mind the table.'],
    punched: ["[cries out] OW! Security! Now, please!", "[yelling] OUCH! What is wrong with you?!", '[groans] Ow! You are done at this table.'],
    doused: ['[sighs] Well. That happened.', "[annoyed] I'm going to need a minute.", "Not cool. Not cool at all."],
    hit: ['[startled] Hey! Not at the table!', 'Ow! Please stop.', "[firm] Next one gets you escorted out."],
  },
  crew_rocco: {
    pushed: ["[laughs] Hey! You wanna go, huh?", 'Whoa! Easy, tiger!', "[laughs] Shovin' me? Me?!"],
    punched: ["[shouting] OW! Okay! OKAY! It's on now!", "[laughs, pained] OUCH! Ha! Nice shot, ya jerk!", "[yelling] OW! My jaw! You're buyin' the next round!"],
    doused: ['[laughing] You son of a... You are SO dead!', "[shouting] Oh, it's ON! It's on now!", "[laughs] Okay, okay. Revenge is comin'. Sleep with one eye open."],
    hit: ["[laughs] Ow! Who threw that? Was that you?!", "Hey! Okay, that was a good throw, I'll admit it.", "[shouting] You're gonna pay for that, buddy!"],
  },
  crew_dev: {
    pushed: ['[dry] Wow. Very mature.', 'Okay, okay. Hands to yourself.', '[sighs] Classic.'],
    punched: ["[shouting] OW! Dude! I bruise like a peach!", "[yelling] OUCH! I'm telling everyone about this!", '[groans] Ow. Okay. Wow. Okay. Noted.'],
    doused: ["[deadpan] Cool. Great. Love that for me.", "[annoyed] You know I'm getting this on camera next time, right?", "[sighs] I'm not even mad. Okay, I'm a little mad."],
    hit: ['[dry] Ow. Your aim is still terrible, by the way.', 'Hey! Really?', "[sarcastic] Oh, great. Throwing things. That's new."],
  },
  crew_mikey: {
    pushed: ['Whoa! Hey! [laughs] Careful!', '[giggles] Stop it!', "Hey! I'm already wobbly!"],
    punched: ["[yelping] OW! OW! Why?! I thought we were friends!", "[crying out] OUCH! Okay, that really hurt, man!", '[whimpers] Ow... my face... I love you guys though.'],
    doused: ["[whining] Aw, man! I'm all sticky now!", "[shocked] Dude! Why?! That was my good shirt!", "[laughs, then annoyed] Okay, that was funny. But also, why?!"],
    hit: ['[yelps] Ow! Hey!', "[whining] Guys! Stop throwing stuff at me!", "Ow! Okay, who did that?!"],
  },
};

/** Who you are, out loud: your chosen reply spoken in your character's voice (masc / fem). */
export const PLAYER_VOICES = { male: 'you_m', female: 'you_f' } as const;

/** Stand-in (Kokoro) voices for you, until the ElevenLabs takes are in. */
export const PLAYER_STANDIN = { male: 'am_eric', female: 'af_jessica' } as const;

/** Every reply you can pick in a conversation (the regulars' and the shared openers'). */
export function replyLabels(): string[] {
  const out = new Set<string>();
  type N = { replies?: { label: string; next?: N }[] };
  const walk = (n: N) => {
    for (const r of n.replies ?? []) {
      out.add(r.label);
      if (r.next) walk(r.next);
    }
  };
  for (const ch of GUESTS) for (const n of ch.openers) walk(n as N);
  for (const list of Object.values(OPENERS)) for (const n of list) walk(n as N);
  return [...out];
}
