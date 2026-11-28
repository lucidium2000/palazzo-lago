/**
 * Fight mode's lines: what the regulars who'll fight you say in a fight
 * (squaring up, landing one, taking one, winning, losing, getting up off the
 * floor), your crew egging you on, the rest of the regulars in the crowd,
 * your own voice, and an original arcade-style announcer (el_announcer: deep,
 * booming, hype; cast in the recording session).
 *
 * All original. Lines carry ElevenLabs v3 performance tags ([shouting], ...);
 * the stand-ins read only the words. Until a take is recorded a line is a
 * caption with a wordless effort sound (fighters) or a synthesized sting (the
 * announcer), never the browser's speech voice.
 *
 * Listed for the recording session by scripts/fight-lines.ts
 * (scripts/fight-lines.json) and scripts/voice-lines.ts (eleven-lines.json).
 */

export type FightMoment = 'taunt' | 'land' | 'hurt' | 'win' | 'lose' | 'getup';
export const FIGHT_MOMENTS: readonly FightMoment[] = ['taunt', 'land', 'hurt', 'win', 'lose', 'getup'];

/** What each moment is, for the recording session. */
export const MOMENT_CONTEXT: Record<FightMoment, string> = {
  taunt: 'squaring up to the player at the start of a fight (fists up, a crowd around)',
  land: 'just landed a punch on the player in a fight: cocky, breathing hard',
  hurt: 'just took a punch from the player in a fight: winded, angry',
  win: 'won the fight against the player (the player is down or beaten): gloating',
  lose: 'lost the fight against the player: sore, beaten, catching their breath',
  getup: 'getting up off the floor after being knocked down, groggy, between rounds',
};

/** The regulars who'll actually fight you (temperament 'brawl'), and security once you swing at them. */
export const FIGHTER_LINES: Record<string, Record<FightMoment, string[]>> = {
  sal: {
    taunt: ["[cracks knuckles] I've been thrown out of better joints than this, kid.", "[low, menacing] Forty years in this town. You wanna be my encore?", '[growls] Alright. Let\'s dance.', "[chuckles darkly] I used to sing in this room. Tonight I'm swingin'."],
    land: ['[grunts] Still got it!', "[laughs] That's from the old days, kid.", '[breathing hard] How was that for a high note?', '[snarls] Sit DOWN.'],
    hurt: ['[grunts] Oof. Lucky shot.', "[pained] Okay. Okay. That's one.", '[growls] You hit like a cocktail napkin.', '[wheezing] Ohh, that one I felt.'],
    win: ["[breathing hard] Show's over, kid. Tip the band.", "[laughs] Told ya. Forty years.", '[satisfied] And that is how we did it in seventy-eight.'],
    lose: ["[groans] Alright. Alright. You got me, kid.", '[wheezing] I need a drink. And a chiropractor.', "[pained laugh] Ain't the first time I closed a show on the floor."],
    getup: ["[groggy] Who turned the lights out? I wasn't finished.", '[grunting] Up. Up. Not done yet.', "[shakes it off] Ohh. That's the second set. Here we go."],
  },
  vinnie: {
    taunt: ["[shouting] You wanna go, my friend? Let's GO!", "[laughing] Oh, this is gonna be beautiful. Somebody hold my watch!", "[rolling up sleeves] This suit's Italian. These hands? Jersey.", "[fired up] Alright, alright! Everybody back up! Give us room!"],
    land: ["[shouting] BOOM! You feel that, my friend?", '[laughing] Ha! Right on the button!', "[excited] That's what I'm talkin' about!", "[yelling] Ohhh! Somebody get this guy a menu, 'cause he's eatin' that!"],
    hurt: ["[grunts] Ow! Okay, okay, you got a little pop!", "[shouting] Hey! Not the face, I got pictures tomorrow!", '[pained] Ohh! My friend! Why so serious?', '[groans] Whoa. Whoa. The room is spinning a little.'],
    win: ["[laughing] And THAT'S why they comp my room, baby!", "[shouting] Drinks on me! Not for him, though!", "[breathing hard] No hard feelings, my friend. Okay, a few."],
    lose: ['[groaning] Okay. You win. I need ice. And a cannoli.', "[dazed] Did anybody get the plate of that truck?", "[laughs weakly] Respect, my friend. Respect. Ow."],
    getup: ["[groggy] I'm up! I'm up! Where's my shoe?", "[shaking it off] Woo! Okay! That's a wake-up call!", "[dazed] Who's countin'? Stop countin'!"],
  },
  marcus: {
    taunt: ["[laughs] Oh, y'all seein' this? He really wants it!", "[bouncing] Okay, okay, I'm a lover, but I'm also a fighter!", "[hyped] The groom's gonna hear about this one!", "[shouting] Let's go, then! Bring it!"],
    land: ['[laughing] Ayyy! Did you see that?!', '[hyped] Too quick! Too quick!', "[shouting] That's for the bachelor party!", '[cocky] You good? You good?'],
    hurt: ['[grunts] Ooh! Okay, that was real.', "[pained] Man! I have a toast to give tomorrow!", '[groans] Oh, that went straight to my soul.', '[shouting] Okay! Okay! No more Mr. Nice Guy!'],
    win: ["[laughing] Somebody film that! Send it to the group chat!", "[breathing hard] Best man wins. Literally.", "[hyped] And the crowd goes wild!"],
    lose: ["[groans] Alright, man. You got that one. Good fight.", "[laughs weakly] Don't tell the groom. Please.", '[pained] My face is gonna be in every wedding photo like this.'],
    getup: ["[groggy] I'm good, I'm good. Where am I? Vegas. Right.", '[shaking it off] Whoo! Okay! Round two, baby!', "[dazed] Nobody post that. Nobody post that!"],
  },
  dale: {
    taunt: ["[slow drawl] Son, I've wrestled steers meaner than you.", "[calm] Well. If we're doin' this, let's do it proper.", "[taking off hat] Hold my hat. This won't take long.", "[low] Reckon you're about to learn somethin'."],
    land: ["[grunts] That there's a Texas howdy.", "[chuckles] Felt that one in your boots, didn't ya?", '[drawl] Easy does it, son.', "[satisfied] Mm-hm. Like bustin' a fence post."],
    hurt: ["[grunts] Well, I'll be. You got some kick.", "[pained] Whoo. That'll leave a mark on a man.", '[groans] Now that was uncalled for. But fair.', "[drawl] Alright. Now I'm payin' attention."],
    win: ["[drawl] Shake it off, son. Ain't no shame in it.", "[chuckles] Told ya. Steers.", "[calm] Somebody fetch this boy some water."],
    lose: ["[groans] Well. Hats off to ya, son. Literally.", "[laughs, pained] Ain't been dropped like that since the rodeo.", '[drawl] You fight fair. I respect that.'],
    getup: ["[groggy drawl] Lord have mercy. Where'd my hat go?", "[grunting] Ain't stayin' down. Ain't in my blood.", '[shaking it off] Whoo. Saw stars. Pretty ones.'],
  },
  priya: {
    taunt: ["[cold] Okay. Let's optimize your face.", "[fast] I do Krav Maga on Tuesdays. Today feels like a Tuesday.", "[sharp] You really want to do this? Fine. I'm efficient.", "[cracks neck] Let's make this quick, I have a table waiting."],
    land: ["[sharp] Calculated.", "[satisfied] That's a ninety-percent win rate, by the way.", "[breathing hard] Yeah. Process that.", '[cold] Did you see that coming? No.'],
    hurt: ['[grunts] Ow! Okay, recalculating.', "[angry] Oh, you did NOT just do that!", '[pained] Unbelievable. That actually landed.', "[sharp] Fine. Gloves off."],
    win: ["[satisfied] Told you. Efficient.", "[breathing hard] And that's the quarterly results.", "[cold] Next time, read the room."],
    lose: ["[groans] Okay. Okay. That was not in the model.", "[pained] I need to run a postmortem on that.", "[annoyed, laughing] Fine. You win. Don't make it weird."],
    getup: ["[groggy] I'm fine. I'm fine. That was a data point.", '[shaking it off] Rebooting. Okay. Again.', "[dazed] Did I lose consciousness? I'm billing someone for this."],
  },
  rosa: {
    taunt: ["[low, amused] You came to the wrong table, mijo.", "[cool] Ay. You really want to do this here? Okay.", '[quiet] I grew up with four brothers. Go ahead.', "[smiles] I don't bluff."],
    land: ['[cool] Mm. Read you like a hand.', "[amused] Too slow, cariño.", '[quiet] Again?', "[laughs softly] You telegraph everything."],
    hurt: ['[grunts] Ay! Okay. Now I am awake.', '[angry] Que te pasa?! Okay. Okay.', "[pained] That's the only one you get.", '[hisses] Mm. Lucky.'],
    win: ["[cool] Fold, mijo. Fold.", "[amused] House always wins.", '[quiet] Go home. Ice it.'],
    lose: ["[groans] Ay, Dios mio. Fine. Fine. You won.", '[pained laugh] My brothers are going to love this.', "[cool, hurt] Okay. Good hand. Don't get used to it."],
    getup: ["[groggy] Ay... the lights. Okay. Okay.", "[getting up] I'm not done. Deal again.", '[shaking it off] Mm. That was a bad beat.'],
  },
  security: {
    taunt: ["[firm] Alright. You want it the hard way.", "[calm] Last chance, pal. Hands down.", '[cracks knuckles] Okay. We do this my way now.', "[low] You picked the wrong guy."],
    land: ['[grunts] Stay down.', "[firm] That's enough.", '[calm] I do this every night, pal.', "[low] Easy. Easy."],
    hurt: ['[grunts] Okay. You got one.', "[angry] Now you're done.", '[pained] Ohh. That was a mistake.', "[firm] That's assault on staff, pal."],
    win: ["[calm] It's over. Walk it off.", "[firm] Somebody get him some water. Then the door.", '[breathing hard] Every. Single. Night.'],
    lose: ["[groans] Okay. Okay. Radioing for backup.", '[pained] Not my night.', "[groaning] I don't get paid enough for this."],
    getup: ["[groggy] Alright. Alright. I'm up.", "[grunting] Nobody saw that. Nobody.", '[shaking it off] Okay. Round two.'],
  },
};

/** Your crew, around your fight. */
export type CrewFight = 'egg' | 'youWin' | 'youLose';
export const CREW_FIGHT_CONTEXT: Record<CrewFight, string> = {
  egg: "your crew watching the player's fight, egging them on from the crowd (loud, over a crowd)",
  youWin: 'your crew: the player just won their fight (cheering, ecstatic)',
  youLose: 'your crew: the player just lost their fight (consoling, wincing)',
};
export const CREW_FIGHT: Record<string, Record<CrewFight, string[]>> = {
  crew_rocco: {
    egg: ["[shouting] Hands up! HANDS UP!", "[yelling] Go to the body! The body!", "[hyped] That's my boy! Get him!", '[shouting] Move your feet! Move your feet!', "[laughing, shouting] Oh, he's rattled! Finish it!"],
    youWin: ["[roaring] YEAHHH! That's what I'm talkin' about!", "[laughing] Champ! We got a champ over here!", "[shouting] Drinks are on the champ tonight!"],
    youLose: ["[wincing] Ohhh. Okay. Okay, we'll get 'em next time, buddy.", "[consoling] Hey, hey. You went out swingin'. That counts.", "[sighs] Alright, champ. Ice, then whiskey. In that order."],
  },
  crew_dev: {
    egg: ['[shouting] Duck! DUCK! Oh, you did not duck.', "[dry, loud] I'm filming this, so maybe win?", '[yelling] Jab! Jab! The other jab!', "[shouting] He's open! Why is he open and you're not hitting him?!", "[laughing] This is the best thing that's happened all trip!"],
    youWin: ["[shocked laugh] You actually won! I had money against you!", "[shouting] Okay! Okay! I take back everything!", "[dry] Legend. Absolute legend. Still terrible form."],
    youLose: ["[wincing] Oof. That's going in the slideshow.", "[dry] Well. You tried. Physically.", "[consoling] Hey. You lasted longer than I would've."],
  },
  crew_mikey: {
    egg: ["[shrieking] Get him! Get him! Oh no, don't get hurt!", "[excited] Go, go, GO! I believe in you!", "[yelling] Punch him! Gently! No, hard!", "[nervous] Oh my god. Oh my god. Keep your hands up!", "[cheering] WOOO! You got this!"],
    youWin: ["[squealing] YOU DID IT! I'm gonna cry!", "[sobbing happily] That was so beautiful!", "[cheering] Best friend! Best friend in the world!"],
    youLose: ['[gasps] Are you okay?! Say something!', "[teary] You were so brave, man. So brave.", "[whimpering] I can't watch. I watched. I'm sorry."],
  },
};

/** You (your voice options), in your own fight. */
export const PLAYER_FIGHT_CONTEXT: Record<FightMoment, string> = {
  taunt: 'the player squaring up for a fight (a crowd around)',
  land: 'the player just landed a punch in a fight',
  hurt: 'the player just took a punch in a fight',
  win: 'the player just won the fight',
  lose: 'the player just lost the fight',
  getup: 'the player getting back up after being knocked down, groggy',
};
export const PLAYER_FIGHT: Record<string, Record<FightMoment, string[]>> = {
  you_m: {
    taunt: ["[squaring up] Alright. Let's do this.", "[confident] You sure about this?", "[fists up] Come on, then.", '[exhales] Okay. Dance with me.'],
    land: ['[grunts] Yeah!', "[breathing hard] How'd that feel?", '[laughs] Got you.', '[sharp] There it is.'],
    hurt: ['[grunts] Ugh!', '[pained] Okay. Okay.', "[breathing hard] That's nothing."],
    win: ['[breathing hard] And stay down.', "[laughs] That's the fight.", '[exhales] Good fight. Seriously.'],
    lose: ['[groans] Okay. You got me.', '[pained] Not my night.'],
    getup: ["[groggy] I'm up. I'm up.", '[shaking it off] Whoa. Okay. Again.', "[breathing hard] Not done yet."],
  },
  you_f: {
    taunt: ["[squaring up] Alright. Let's do this.", "[confident] You sure about this?", "[fists up] Come on, then.", "[exhales] Okay. Let's dance."],
    land: ['[grunts] Yes!', "[breathing hard] How'd that feel?", '[laughs] Got you.', '[sharp] There it is.'],
    hurt: ['[grunts] Ugh!', '[pained] Okay. Okay.', "[breathing hard] That's nothing."],
    win: ['[breathing hard] And stay down.', "[laughs] That's the fight.", '[exhales] Good fight. Seriously.'],
    lose: ['[groans] Okay. You got me.', '[pained] Not my night.'],
    getup: ["[groggy] I'm up. I'm up.", '[shaking it off] Whoa. Okay. Again.', "[breathing hard] Not done yet."],
  },
};

/** The rest of the regulars, watching a fight: egging it on. */
export const CROWD_FIGHT_CONTEXT = 'a guest in the crowd around a fight in the casino, shouting and egging it on (excited, loud, over a crowd)';
export const CROWD_FIGHT: Record<string, string[]> = {
  vinnie: ["[shouting] Hey! Hey! Twenty bucks on the big guy!", "[laughing] Now THIS is entertainment!", '[yelling] Uppercut! Uppercut!'],
  dale: ["[hollering] Yeehaw! Now that's a scrap!", "[drawl] Keep your chin down, son!", "[laughs] Haven't seen a dust-up like this since Abilene."],
  marcus: ['[hyped] Ohhh! Fight! FIGHT!', "[laughing] Somebody get this on camera!", "[shouting] Ooh! He felt that one!"],
  reggie: ['[appalled, excited] Good heavens! Have at him!', "[exclaims] I say! Jolly good shot!", '[calling out] Queensberry rules, gentlemen! Queensberry rules!'],
  tommy: ["[nervous] Oh no. Oh no no no. Okay, that's kinda awesome.", '[excited] The odds just shifted! The odds just shifted!', '[yelping] Whoa! Did you see that?!'],
  sal: ['[shouting] Work the body! The body!', "[laughs] Reminds me of the Sands in seventy-two!", "[growls] Keep your hands up, ya bum!"],
  margo: ['[delighted] Ooh! Honey, this is better than the show!', "[shouting] Hit him, sweetheart! Hit him!", '[laughing] Somebody call the paparazzi!'],
  priya: ['[shouting] Left hook! LEFT HOOK!', '[excited] Oh my god, this is happening!', "[fast] My money's on the one in front!"],
  destiny: ['[squealing] Oh my god! Oh my god! Fight!', "[shrieking, laughing] This is SO going on my story!", "[cheering] Woo! Get him, babe!"],
  eleanor: ['[dry] Well. This is livelier than baccarat.', "[calling out] Do mind the carpet, dears!", '[amused] Oh, my. Rather a good one, that.'],
  kayla: ["[wincing] Oh, gosh! That's gonna need ice!", "[shouting] Careful! I'm a nurse, but I'm on vacation!", '[excited] Oh my gosh! Okay! Go, go!'],
  rosa: ["[cool] Mm. My money's on the quiet one.", '[amused] Ay. Boys.', '[calling out] Keep your guard up, mijo.'],
};

/** The announcer: original, arcade-style, booming. */
export const ANNOUNCER_ID = 'announcer';
export const ANNOUNCER = {
  round: ['[booming] Round one!', '[booming] Round two!', '[booming] Round three!'],
  final: '[booming, intense] Final round!',
  fight: '[booming, explosive] Fight!',
  ko: '[booming, drawn out] K.O.!',
  time: '[booming] Time!',
  youWin: '[booming, triumphant] You win!',
  youLose: '[booming] You lose!',
  perfect: '[booming, ecstatic] Perfect!',
  draw: '[booming] Draw!',
  over: '[booming] Fight over!',
  winner: '[booming] Winner!',
};
/** "<Name> wins!" for the regulars (and security). */
export const ANNOUNCER_NAMES = ['Vinnie', 'Dale', 'Marcus', 'Sal', 'Priya', 'Rosa', 'Security'];
export const announcerWins = (name: string) => `[booming, triumphant] ${name} wins!`;

export const ANNOUNCER_CONTEXT = 'the arcade fighting-game announcer of fight mode (an original voice, deep and booming, big hype; heard over the HUD between rounds)';

/** Every announcer line. */
export function announcerLines(): string[] {
  const a = ANNOUNCER;
  return [...a.round, a.final, a.fight, a.ko, a.time, a.youWin, a.youLose, a.perfect, a.draw, a.over, a.winner, ...ANNOUNCER_NAMES.map(announcerWins)];
}

/** The announcer's line for a round. */
export function roundCall(round: number, final: boolean): string {
  return final ? ANNOUNCER.final : (ANNOUNCER.round[round - 1] ?? ANNOUNCER.final);
}
