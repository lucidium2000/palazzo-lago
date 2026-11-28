/**
 * What people say when you get physical with them: bumped or pushed, punched,
 * doused with a drink, or hit by something you threw. One set per speaker (the
 * regulars, the staff and your crew), in their own voice and personality.
 * Lines carry ElevenLabs v3 performance tags ([gasps], [angry], ...); the
 * stand-in voice reads only the words.
 */

import { GUESTS } from './cast';
import { OPENERS } from './dialogueLines';

/** `security`: yelling for security (or, for the guards, telling you to cool it). `slapped`: an open hand across the face (outraged more than hurt). */
export type ReactKind = 'pushed' | 'punched' | 'doused' | 'hit' | 'security' | 'slapped';

export type ReactLines = Record<Exclude<ReactKind, 'security' | 'slapped'>, string[]> & { security?: string[]; slapped?: string[] };

/**
 * Slapped across the face (fight/slap.ts): shock and outrage, in each
 * regular's own voice (and your crew's). Until a take's recorded the slap
 * falls back to their recorded "punched" yell (dialogue.ts react).
 */
export const SLAPPED: Record<string, string[]> = {
  vinnie: ["[shocked] Did you just SLAP me? Me?!", "[outraged] A slap?! What is this, a soap opera?!", "[holding cheek] Oh, you did NOT just do that, my friend."],
  dale: ["[stunned] Well, I'll be. Did you just slap me, son?", "[slow, angry] Nobody slaps a Texan. Nobody.", "[rubbing jaw] Now that's just plain disrespectful."],
  marcus: ["[shocked] Yo! Did you just SLAP me?!", "[laughing in disbelief] Bro. A slap? A SLAP?", "[outraged] In front of everybody?! Really?!"],
  reggie: ["[appalled] Did you just strike me with an open hand?!", "[sputtering] A slap! How utterly barbaric!", "[indignant] I demand satisfaction, sir!"],
  tommy: ["[squeaking] Did you just slap me?! Why?!", "[stunned] Ow! Okay! That was a slap! That was definitely a slap!", "[whimpering] My face... Mom's never even slapped me."],
  sal: ["[cold] You slapped me. You actually slapped me.", "[growls] Kid. Nobody slaps Sal.", "[low, menacing] That was the last mistake you make tonight."],
  margo: ["[gasps] Did you just SLAP me, honey?!", "[outraged] Oh, no. No, no, no. Not the face, sweetheart!", "[shrieks] You slapped a showgirl?! In this town?!"],
  priya: ["[shocked] Did you seriously just slap me?!", "[furious] Oh my god. You SLAPPED me.", "[cold] Wow. That's assault. You know that, right?"],
  destiny: ["[shrieks] Oh my god! Did you just SLAP me?!", "[crying out] On my bachelorette?! Seriously?!", "[outraged] Girls! He just slapped me!"],
  eleanor: ["[gasps] Did you just slap me, young man?!", "[icy] In all my years. A slap.", "[indignant] I have buried two husbands for less."],
  kayla: ["[shocked] Ow! Did you just slap me?!", "[stunned] What? Why would you slap a nurse?!", "[angry] Oh, you're lucky I'm off duty."],
  rosa: ["[very cold] Did you just slap me, mijo?", "[quiet fury] Ay. You slapped me. Okay.", "[hisses] Que te pasa?! A slap?!"],
  crew_rocco: ["[laughing, outraged] Did you just SLAP me?! Oh, it's on!", "[shouting] A slap?! What are we, twelve?!"],
  crew_dev: ["[deadpan] Did you just slap me. In public.", "[dry] Wow. A slap. Very dramatic."],
  crew_mikey: ["[yelping] Ow! You slapped me! Why?!", "[whining] Hey! That's my face!"],
};

export const REACTIONS: Record<string, ReactLines> = {
  vinnie: {
    pushed: ['Whoa, whoa! Easy, my friend!', "Hey! What's the rush?", '[grunts] Watch it, pal.', "Ay! You're gonna knock me over!"],
    punched: ['[shouting] OW! What the hell?!', '[groans] Oh! Oh, you did NOT just do that!', "[yelling] OUCH! You know who I am?!"],
    doused: ["[shocked] Are you kiddin' me?! This is Italian silk!", '[angry] Oh, come on! The suit! THE SUIT!', "You did not just throw a drink on me. You did NOT."],
    hit: ["[angry] Hey! Who threw that?!", "Ow! What are you, a pitcher for the Mets?", "[shouting] You throw things at me? Me?!"],
    security: ["[shouting] SECURITY! Somebody get this guy outta here!", "[yelling] Hey! SECURITY! Over here!"],
  },
  dale: {
    pushed: ['Whoa there, partner.', '[grunts] Easy now.', "Hey now, ain't no stampede in here.", 'Mind yourself, son.'],
    punched: ['[groans loudly] OW! Well, I\'ll be... that smarts!', "[shouting] OUCH! Now that ain't neighbourly!", '[pained] Ow! You best not do that again, son.'],
    doused: ["[sighs] Well, that's a perfectly good whiskey wasted.", "[annoyed] Now what in the Sam Hill was that for?", "Son, in Texas, that'll get you thrown out of a bar."],
    hit: ["[angry] Hey! Who's throwin' things?", "Ow! You got a decent arm, I'll give ya that. Now quit it.", "[annoyed] Lord have mercy. Quit chuckin' stuff."],
    security: ["[hollering] SECURITY! We got us a troublemaker!", "[shouting] Somebody fetch security, now!"],
  },
  marcus: {
    pushed: ['Whoa, excuse you.', '[annoyed] Watch where you\'re going, man.', 'Hey, personal space.', 'Do you mind?'],
    punched: ["[shouting] OW! Are you serious?!", '[groans] Oh, that is assault, man! That is assault!', '[yelling] OUCH! My face! I have a meeting tomorrow!'],
    doused: ['[outraged] This shirt is four hundred dollars!', "[angry] Unbelievable. Absolutely unbelievable.", "You're paying for my dry cleaning. All of it."],
    hit: ['[angry] Did you just throw that at me?', 'Ow! What is wrong with you?', "[annoyed] Seriously? Grow up."],
    security: ["[shouting] SECURITY! I need security over here, now!", "[yelling] Security! This guy's assaulting people!"],
  },
  reggie: {
    pushed: ['I say! Do mind yourself.', '[huffs] Steady on, old chap.', 'Good heavens, watch where you tread.', 'Pardon me!'],
    punched: ["[shouting] OW! Good LORD! You absolute brute!", '[groans] Oh! Oh, my jaw! This is an outrage!', "[yelling] OUCH! I shall be speaking to the manager!"],
    doused: ['[appalled] Well! I have never been so insulted!', "[indignant] You've soaked my blazer, you savage.", 'How dare you. How DARE you, sir.'],
    hit: ['[angry] I beg your pardon! Was that thrown at me?', 'Ow! Hooligan!', "[indignant] Utterly uncivilised."],
    security: ["[shouting] SECURITY! Security, I say! Remove this hooligan!", "[yelling] Guards! GUARDS! Somebody!"],
  },
  tommy: {
    pushed: ["Whoa! Easy, bro!", "[laughs] Hey, what's up with the shoving?", "Dude! Watch it!", "Hey, hey, I'm walking here!"],
    punched: ["[shouting] OW! Bro! What the heck?!", "[groans] Ohhh, dude. Why?! Why would you do that?", "[yelling] OUCH! Not cool, man! NOT cool!"],
    doused: ["[shocked] DUDE! I just got this shirt!", "[angry] Bro, are you serious right now?!", "[groans] Oh man, now I smell like a frat house."],
    hit: ["[angry] Yo! Who threw that?!", "Ow! Dude, that hurt!", "[annoyed] Bro, quit throwing stuff!"],
    security: ["[yelling] Yo, SECURITY! Security, help!", "[shouting] SECURITY! This dude's crazy!"],
  },
  sal: {
    pushed: ['[grumbles] Hey. Easy.', 'Watch it.', "You got a problem?", '[grunts] Mind the elbows.'],
    punched: ["[roaring] OW! You got a death wish, kid?!", '[groans] Ohh. Oh, that was a mistake. Big mistake.', "[yelling] OUCH! You know how many guys tried that?!"],
    doused: ['[cold, angry] You just made a very bad decision.', "[growls] This is a forty-year-old suit, kid.", "Now we got a problem, you and me."],
    hit: ['[angry] You throwin\' things at me?', 'Ow. You\'re lucky I\'m in a good mood.', "[menacing] Do that again. I dare ya."],
    security: ["[roaring] SECURITY! Get over here before I handle it myself!", "[shouting] Security! Now!"],
  },
  margo: {
    pushed: ['Oh! Excuse you, honey.', '[gasps] Watch it, sweetheart!', "Hey! Who taught you manners?", 'Easy, darling!'],
    punched: ["[shrieks] OW! Did you just HIT me?!", '[yelling] OUCH! Security! SECURITY!', "[groans] Ohh! You little... OW!"],
    doused: ['[shrieks] My HAIR! Do you know how long this took?!', "[outraged] This is vintage, you animal!", "[angry] Oh, you are going to regret that, sweetie."],
    hit: ['[angry] Excuse me?! Did you throw that at me?', 'Ow! Who raised you?', "[annoyed] Honey, aim somewhere else."],
    security: ["[shrieking] SECURITY! SECURITY! Somebody help me!", "[yelling] Security, darling! NOW!"],
  },
  priya: {
    pushed: ['Oh! Excuse me.', '[surprised] Hey, careful!', "Um, can you not?", 'Whoa, watch it.'],
    punched: ["[shouting] OW! What is WRONG with you?!", "[yelling] OUCH! I'm calling security!", '[groans] Oh my god, that actually hurt!'],
    doused: ["[gasps] Are you serious?! My dress!", "[angry] Oh my god. Oh my GOD.", "That's it. I'm done. You're unbelievable."],
    hit: ['[angry] Did you just throw something at me?', 'Ow! Seriously?!', "[annoyed] Wow. Real mature."],
    security: ["[shouting] SECURITY! Can someone get security, please?!", "[yelling] Security! Over here!"],
  },
  destiny: {
    pushed: ["Whoa! Watch it, babe!", "[laughs] Hey! No pushing!", "Um, excuse you?", 'Easy there!'],
    punched: ["[screams] OW! Oh my god, you HIT me!", "[yelling] OUCH! What is your problem?!", '[crying out] OW! That really hurt, you jerk!'],
    doused: ["[shrieks] NO! My outfit! I'm posting about this!", "[angry] Oh my god, I'm literally soaked!", "[outraged] Are you kidding me right now?!"],
    hit: ['[angry] Hey! Who threw that?!', 'Ow! Rude!', "[annoyed] Seriously? Not the face!"],
    security: ["[screaming] SECURITY! Oh my god, SECURITY!", "[yelling] Somebody call security! Like, NOW!"],
  },
  eleanor: {
    pushed: ['Oh my! Careful, dear.', '[gasps] Goodness! Do watch yourself.', 'Young man, please!', 'Mind your step, dear.'],
    punched: ["[cries out] OW! Oh, you horrible person!", "[yelling] OUCH! Somebody help!", '[gasps in pain] Oh! At my age!'],
    doused: ['[appalled] Well, I never! In all my years!', "[indignant] My good pearls! Shame on you.", "Your mother would be ashamed of you, dear."],
    hit: ['[startled] Oh! Who threw that?', 'Ow! Really, now!', "[disapproving] Such behaviour in a place like this."],
    security: ["[crying out] Security! Oh, somebody, SECURITY!", "[shouting] Help! Security, please!"],
  },
  kayla: {
    pushed: ["Hey! Watch it!", "[annoyed] Ugh, seriously?", "Excuse me?!", 'Whoa, easy!'],
    punched: ["[screaming] OW! Are you INSANE?!", "[yelling] OUCH! I'm calling the cops!", "[groans] Oh my god, ow, ow, OW!"],
    doused: ["[shrieks] EW! It's in my hair!", "[furious] You did NOT just do that!", "[angry] Oh, you're so dead. You're so dead."],
    hit: ["[angry] Who threw that?! Was it you?", "Ow! What the heck?!", "[annoyed] Ugh. Grow up."],
    security: ["[screaming] SECURITY! Get this creep away from me!", "[yelling] SECURITY! Are you serious?! SECURITY!"],
  },
  rosa: {
    pushed: ['Ay! Cuidado!', '[annoyed] Hey, careful, careful.', 'Whoa, slow down, mijo.', 'Excuse me!'],
    punched: ["[shouting] AY! OW! Que te pasa?!", '[yelling] OUCH! Are you crazy?!', "[groans] Ay, Dios mio, that hurts!"],
    doused: ['[outraged] Ay, no! My dress! Que asco!', "[angry] You think that's funny? Huh?", "Oh, you're lucky my sister isn't here."],
    hit: ["[angry] Ay! Who threw that?", 'Ow! Mira, stop it!', "[annoyed] Que maleducado."],
    security: ["[shouting] SECURITY! Ay, somebody call security!", "[yelling] Security! Ahora! NOW!"],
  },
  bartender: {
    pushed: ["Whoa, careful, hon!", "[laughs] Easy, I've got a tray here!", "Hey, mind the bar, sweetie."],
    punched: ["[shouting] OW! Okay, you're cut off!", "[yelling] OUCH! Security, now!", "[groans] Oh, you did not just hit the bartender."],
    doused: ["[sighs] Wow. Wasting my good work on me?", "[annoyed] Okay. That's your last drink tonight.", "Real classy. Real classy."],
    hit: ["[angry] Hey! No throwing at the bar!", "Ow! You're cut off, pal.", "[annoyed] Seriously? I'm working here."],
    security: ["[shouting] SECURITY! Trouble at the bar!", "[yelling] Security! I need you at the bar, now!"],
  },
  waiter: {
    pushed: ['Oh! Pardon me.', '[startled] Careful, sir, careful.', 'Mind the tray, please!'],
    punched: ["[cries out] OW! Sir! That is entirely uncalled for!", "[yelling] OUCH! Security!", '[groans] Oh! Oh, my nose!'],
    doused: ["[composed, annoyed] I'll... just fetch a towel, then.", "[sighs] That will not be reflected well in your tip, I imagine.", "Charming. Truly."],
    hit: ['[startled] Oh! Who threw that?', 'Ow! Please, sir!', "[annoyed] We do not throw things in the Palazzo."],
    security: ["[shouting] SECURITY! Assistance, please!", "[calling out] Security! Over here, quickly!"],
  },
  waitress: {
    pushed: ['Oh! Careful, hon, careful!', '[startled] Whoa, mind the tray!', 'Easy there, sweetie.'],
    punched: ["[cries out] OW! Are you kidding me?!", "[yelling] OUCH! Security! Now!", '[groans] Ow! Oh, you are SO cut off.'],
    doused: ["[gasps] Seriously?! I just got this dress cleaned!", "[annoyed] Wow. That's coming out of your tip.", "Real classy. Real classy, hon."],
    hit: ['[startled] Hey! Who threw that?', 'Ow! Watch it!', "[annoyed] Not at the staff, please!"],
    security: ["[shouting] SECURITY! Help! Over here!", "[yelling] Security, please! Now!"],
  },
  croupier: {
    pushed: ['Pardon, monsieur.', '[stiffly] Please, keep your distance from the wheel.', 'Careful, s\'il vous plait.'],
    punched: ["[shouting] OW! Mon dieu! Security!", "[yelling] OUCH! This is a disgrace!", '[groans] Ah! You will be escorted out, monsieur!'],
    doused: ['[icy] Charming. Truly charming.', "[indignant] On my good waistcoat? Quelle horreur.", 'I will pretend that did not happen. Once.'],
    hit: ['[annoyed] Please! Not at the table!', 'Ow! Monsieur, really!', "[cold] Do that again and you will play elsewhere."],
    security: ["[shouting] SECURITY! Sécurité, immédiatement!", "[calling out] Security to the roulette table, please!"],
  },
  stickman: {
    pushed: ['Whoa! Easy, champ!', '[laughs] Hey, no shoving at the rail!', 'Careful, careful!'],
    punched: ["[shouting] OW! Hey! What're you, nuts?!", "[yelling] OUCH! Pit boss! PIT BOSS!", '[groans] Ohh, that\'s a seven-out for you, pal!'],
    doused: ["[annoyed] Aw, come on! Not on the felt!", "[angry] You're payin' for this shirt, buddy!", "Real smooth. Real smooth."],
    hit: ['[angry] Hey! Throw the dice, not the glassware!', 'Ow! Watch it!', "[annoyed] Wrong thing to throw, champ."],
    security: ["[yelling] SECURITY! Pit boss! We got a problem!", "[shouting] Security to craps! Now!"],
  },
  dealer: {
    pushed: ['Oh! Careful, please.', '[calm] Easy there.', 'Please mind the table.'],
    punched: ["[cries out] OW! Security! Now, please!", "[yelling] OUCH! What is wrong with you?!", '[groans] Ow! You are done at this table.'],
    doused: ['[sighs] Well. That happened.', "[annoyed] I'm going to need a minute.", "Not cool. Not cool at all."],
    hit: ['[startled] Hey! Not at the table!', 'Ow! Please stop.', "[firm] Next one gets you escorted out."],
    security: ["[shouting] SECURITY! Security to the blackjack table!", "[firm, loud] Security, please! Right now!"],
  },
  security: {
    pushed: ['[firm] Hands off, pal.', "[warning] Don't push me.", '[grunts] Easy. Real easy.'],
    punched: ['[roaring] OW! Alright, that\'s it!', "[shouting] OUCH! You just made a big mistake!", '[groans] Oh, now you\'re done!'],
    doused: ['[cold] That was a bad idea.', "[annoyed] Really? On the suit?", "[firm] You're leaving. Now."],
    hit: ['[angry] Throw one more thing. I dare you.', 'Ow! Knock it off!', "[firm] Strike two, buddy."],
    security: ["[firm] Security. Let's keep it friendly, alright?", '[firm] Easy. Hands down, take a walk.', "[calm, firm] Alright, alright. Break it up.", "[stern] That's enough. Walk it off or you're out."],
  },
  // The Promenade's staff.
  cook_pizza: {
    pushed: ['Whoa, easy, pal!', "[laughs] Hey, no shovin' at the counter!", 'Watch it, I got a hot oven here!'],
    punched: ["[shouting] OW! Hey! What're you, nuts?!", "[yelling] OUCH! You just lost your slice privileges, pal!", '[groans] Ohh, right in the kisser. Security!'],
    doused: ["[annoyed] Aw, come on! On the apron?", "[angry] Hey! I'm workin' here, ya know!", 'Real nice. Real nice. You want a slice with that?'],
    hit: ["[angry] Hey! Who's throwin' stuff at the cook?!", "Ow! Throw the dough, not at the guy makin' it!", '[annoyed] Knock it off, pal!'],
    security: ["[shouting] SECURITY! We got a wise guy at the pizza counter!", '[yelling] Hey, SECURITY! Over here!'],
  },
  cook_burger: {
    pushed: ['Whoa there, partner!', "[laughs] Easy now, the grill ain't goin' anywhere.", 'Hey! Mind the spatula!'],
    punched: ["[hollering] OW! Now that ain't how you order a burger!", "[yelling] OUCH! You're eighty-sixed, buddy!", '[groans] Oh, that smarts! Security!'],
    doused: ["[annoyed] Well, that's one way to cool off the grill.", "[angry] Hey! I just washed this apron!", "Real funny, friend. Real funny."],
    hit: ["[angry] Hey! Who's chuckin' things at the grill?!", "Ow! Quit it, ya knucklehead!", "[annoyed] Throw one more thing and you're flippin' burgers yourself."],
    security: ['[hollering] SECURITY! Trouble at the burger counter!', "[shouting] Somebody get security over here, now!"],
  },
  cook_noodles: {
    pushed: ['Hey. Careful.', '[dry] The wok is hot. So is my temper.', 'Easy. Personal space.'],
    punched: ["[shouting] OW! Are you serious?!", "[yelling] OUCH! Okay. You're banned from noodles.", '[groans] Ow. Security. Now, please.'],
    doused: ['[deadpan] Wonderful. Thank you for that.', "[annoyed] I'm going to need a minute. And a towel.", "Really? That's the move?"],
    hit: ['[annoyed] Hey! Not at the kitchen!', 'Ow! Watch it.', '[dry] Nice throw. Terrible idea.'],
    security: ['[shouting] SECURITY! Noodle bar, please!', '[firm, loud] Security! Over here, right now!'],
  },
  cook_gelato: {
    pushed: ['Ah! Piano, piano!', '[startled] Ehi! Careful, please!', "Easy! I'm holding a scoop!"],
    punched: ['[cries out] OW! Mamma mia! Why?!', "[yelling] OUCH! Security! Aiuto!", '[groans] Ow! No gelato for you. Never!'],
    doused: ["[gasps] Ma dai! Seriously?!", "[annoyed] Now I'm all sticky. Grazie mille.", "Che schifo! That's disgusting!"],
    hit: ['[startled] Ehi! Who threw that?!', 'Ow! Basta!', '[annoyed] Not at the gelato, per favore!'],
    security: ['[shouting] SECURITY! Aiuto! Help!', '[yelling] Security! At the gelato counter, please!'],
  },
  clerk: {
    pushed: ['Oh! Excuse you.', '[cool] Careful, please. The displays are glass.', 'Do mind the shelves.'],
    punched: ["[cries out] OW! How DARE you!", "[yelling] OUCH! Security! Now!", "[groans] Ow! You'll be leaving. Immediately."],
    doused: ['[icy] Charming. This is silk.', "[gasps] On the cashmere? Really?", "[cold] I'll add the dry cleaning to your bill."],
    hit: ['[startled] Excuse me! Was that thrown at me?', 'Ow! Not in the boutique!', '[cold] Do that again and you will shop elsewhere.'],
    security: ['[shouting] SECURITY! Lago Luxe, please!', '[firm, loud] Security! To the boutique, right now!'],
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
