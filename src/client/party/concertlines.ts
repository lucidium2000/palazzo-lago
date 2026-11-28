import type { Node } from '../dialogueLines';

/**
 * What people say at the pool party: all about the show (NIXIE VALE and her
 * band, the DJ, the stage, the lights, getting up front), never the casino's
 * tables. One set per regular (cast.ts ids, in their own ElevenLabs voice:
 * el_<id>), for each moment of the night:
 *
 *   soon   her set is coming up: is she on yet, what she'll open with
 *   live   she's on: shouts, cheers, wordless singing along (no lyrics quoted)
 *   after  between songs and once her set's over: what a show
 *   dj     the DJ's stretch: the DJ, the lights, the pool
 *
 * plus what they say passing you, talking with you, and when you shove them,
 * soak them or throw something at them at the concert.
 *
 * NIXIE (el_nixie) speaks only between her sets, and only about the show; on
 * stage she says nothing (party/partytalk.ts). Your crew have a few lines of
 * their own out here.
 *
 * Every line here is new: scripts/concert-lines.json lists them for the
 * ElevenLabs session (scripts/concert-lines.ts makes it), and they're
 * recorded like every other take (public/voices/<voice>/<lineId>.mp3). Until a
 * take is in, a line is a speech bubble and a wordless cheer, never the
 * browser's robot voice. Square-bracket tags ([shouting], [laughs]) are
 * ElevenLabs v3 performance tags: performed, not spoken.
 */

export type PartyPhase = 'soon' | 'live' | 'after' | 'dj';
export const PARTY_PHASES: PartyPhase[] = ['soon', 'live', 'after', 'dj'];

export type PartyReact = 'pushed' | 'doused' | 'hit' | 'punched';

export interface ConcertSet {
  soon: string[];
  live: string[];
  after: string[];
  dj: string[];
  /** Said to you as you pass. */
  quips: string[];
  /** Asked how they're doing. */
  how: string;
  /** Striking up a conversation with you. */
  opener: Node;
  /** Clinking glasses with you. */
  cheers: string;
  /** Didn't catch what you said over the music. */
  huh: string;
  bye: { walkedOff: string; timedOut: string };
  react: Record<PartyReact, string[]>;
}

export const CONCERT: Record<string, ConcertSet> = {
  vinnie: {
    soon: ["My friend! Nixie Vale, live, at the pool. You believe this?", "Is she on yet? I been standin' here since the DJ started!", "I heard she's openin' with Chasing Dawn. Swear on my mother."],
    live: ['[shouting] NIXIE! I love you, sweetheart!', '[cheering] Whooo! Yeah!', "[shouting] Chasing Dawn! That's my song!", '[shouting] Unbelievable! UN-BE-LIEVABLE!'],
    after: ['My friend, I got chills. Look at my arms. Chills!', '[laughs] One more! One more! Come on, Nixie!'],
    dj: ["This DJ's got the whole deck jumpin', huh?", "Look at these lights, my friend! It's like a spaceship landed."],
    quips: ['Get up front, my friend! You gotta see her up close!', 'You feel that bass? Right in the chest, my friend!'],
    how: "Me? I'm at a Nixie Vale show at a pool party. I'm in heaven, my friend!",
    opener: {
      say: "My friend! You here for Nixie? Tell me you're here for Nixie.",
      replies: [
        { label: 'Big fan', end: 'I knew it! You got taste. Get up front with me!' },
        { label: 'Just the party', end: "Ah, stick around. Five minutes in, you'll be a fan. Trust me." },
      ],
    },
    cheers: 'Salute! To Nixie!',
    huh: "Ha! I can't hear nothin' over this bass. Whatever you said, I agree!",
    bye: { walkedOff: 'Go get up front, my friend! Enjoy the show!', timedOut: "Eh, you're savin' your voice for the show. Smart." },
    react: {
      pushed: ["Whoa, whoa! Easy, my friend, I'm watchin' the show!", "Hey! No cuttin', pal! I been here since the DJ!"],
      doused: ["[shocked] Are you kiddin' me?! In the middle of the concert?!", "[angry] The suit! At a concert! What's wrong with you?!"],
      hit: ["[angry] Hey! Who's throwin' stuff at a concert?!"],
      punched: ["[yelling] OW! I'm here to see a show, not be in one!"],
    },
  },
  dale: {
    soon: ['Well, folks say this Nixie gal puts on one heck of a show.', "Any minute now, I reckon. The band's gear is all set up.", "Heard she opens with Chasing Dawn. Good name for a song."],
    live: ['[hollering] Yeehaw! Go on, Nixie!', '[whistles loudly] Whoo!', "[hollering] That's what I'm talkin' about!", "Well, I'll be. That gal can SING!"],
    after: ["Now that's a show worth stayin' up for.", '[whistles] Give that band a raise, I say.'],
    dj: ["That DJ's got this whole deck movin'. Even me, a little.", "Never been to a pool party at night. Lights are somethin' else."],
    quips: ["Evenin'. Squeeze on up, plenty of room by the stage.", "Mind the speakers, partner. They'll rattle your teeth."],
    how: "Fine as frog hair, partner. Waitin' on the show.",
    opener: {
      say: "You catch her last set, partner? Folks are still talkin' about it.",
      replies: [
        { label: 'Yeah, amazing', end: "Ain't it? Like a thunderstorm with a backbeat." },
        { label: 'Not yet', end: "Well, you're in for a treat. Find yourself a good spot." },
      ],
    },
    cheers: "Here's to the band, partner.",
    huh: "Can't hear a lick over that bass, partner. But I'm with ya.",
    bye: { walkedOff: 'Enjoy the show, partner.', timedOut: "Well, alright. Save your hollerin' for the stage." },
    react: {
      pushed: ["Whoa there, partner. Folks are tryin' to see the stage.", "Easy now. Ain't no stampede at this concert."],
      doused: ["[annoyed] Now that's a perfectly good drink wasted, mid-song.", '[sighs] Son, I came to hear music, not get a bath.'],
      hit: ["[annoyed] Quit chuckin' stuff, folks are watchin' a show."],
      punched: ["[groans] OW! That ain't how you dance, son!"],
    },
  },
  marcus: {
    soon: ['Yo, is she on yet? I need to see Nixie Vale tonight!', "I heard she's opening with Chasing Dawn. The groom's gonna freak out.", "Front row or nothing, that's the plan. Let's go!"],
    live: ["[shouting] NIXIE! NIXIE! Let's GOOO!", '[cheering] Whooo! Come on!', '[shouting] Sing it! SING IT!', '[laughs] She is unreal! Are you seeing this?!'],
    after: ['Bro. BRO. That was a whole movie.', '[laughs] My voice is gone. Totally worth it.'],
    dj: ["This DJ is cooking! I'm sweating already. [laughs]", "These lights, man! It's like we're inside a music video."],
    quips: ['Ayy, come get up front with us!', "You ready to scream yourself hoarse tonight? [laughs]"],
    how: "Man, I'm great! Pool party, live show, best night of the trip!",
    opener: {
      say: "Yo! You seen Nixie live before? Because I'm about to cry. [laughs]",
      replies: [
        { label: 'First time', end: "Oh, you're gonna love it. Phones up for the chorus!" },
        { label: 'Seen her before', end: 'Then you know! Lead the way to the front, my guy!' },
      ],
    },
    cheers: 'To Nixie, baby! Cheers!',
    huh: "[laughs] Can't hear you over the bass, but I love the energy!",
    bye: { walkedOff: "Catch you up front! Let's go!", timedOut: 'Alright, alright, save it for the chorus!' },
    react: {
      pushed: ["Whoa, excuse you! I'm trying to see the stage!", 'Hey, easy, man! Everybody wants the front.'],
      doused: ['[outraged] Bro! In the middle of the show?!', '[angry] My concert outfit! Unbelievable.'],
      hit: ['[angry] Did you just throw that? At a concert?'],
      punched: ['[shouting] OW! Are you serious?! During the show?!'],
    },
  },
  reggie: {
    soon: ["I'm told this Nixie Vale is rather extraordinary live.", "Is she on yet? I've been standing here for a small eternity.", "Apparently she opens with Chasing Dawn. I've been humming it all week."],
    live: ['[shouting] Bravo! BRAVO!', '[cheering] Whoo! Oh, I say!', 'Marvellous. Absolutely marvellous.', '[shouting] Encore! Well, eventually. ENCORE!'],
    after: ['I believe I have just become a fan. How embarrassing.', "That was rather magnificent, wasn't it?"],
    dj: ['The DJ is splendid. I may even attempt to dance.', "These lights are quite something. Like a very elegant thunderstorm."],
    quips: ['Do find a spot near the front, the sound is glorious.', "Mind the speakers, old chap. One's ears are precious."],
    how: 'Splendid, thank you. Waiting for the headliner, like a proper fan.',
    opener: {
      say: 'Forgive me, but do you know when Miss Vale comes on?',
      replies: [
        { label: 'Any minute now', end: 'Splendid. I shall hold my position, then.' },
        { label: 'No idea', end: 'Ah, well. The suspense is half the fun, I suppose.' },
      ],
    },
    cheers: 'To the band. Cheers.',
    huh: "Terribly sorry, the music's rather loud. I'll assume you agree.",
    bye: { walkedOff: 'Enjoy the concert.', timedOut: 'Ah. Saving your voice. Very wise.' },
    react: {
      pushed: ['I say! Some of us are trying to watch the stage.', "Steady on, old chap. There's a concert happening."],
      doused: ['[appalled] In the middle of the show! Have you no manners?', "[indignant] You've soaked my blazer, mid-chorus."],
      hit: ['[indignant] Was that thrown at me? At a concert?'],
      punched: ['[yelling] OUCH! This is a concert, not a brawl!'],
    },
  },
  tommy: {
    soon: ["Is she on yet? I'm not too late, right?", "Okay, okay. I heard she's opening with Chasing Dawn. I'm so nervous. Why am I nervous?", "I've never been to a real concert. Is it okay that I'm shaking?"],
    live: ['[shouting] NIXIE! Oh my gosh, NIXIE!', '[cheering] Whooo! Ha, I did a whoo!', '[shouting] This is the best night of my life!', '[squealing] She looked at me! I think she looked at me!'],
    after: ['Did that really just happen? Was I there?', "My ears are ringing. Is that normal? That's normal, right?"],
    dj: ['Is it okay if I dance? Like, is anyone watching? Okay. Okay.', "The lights are so cool. I'm taking a video for my mom."],
    quips: ['Hi! Are you here for Nixie too? Me too!', 'Is this a good spot? It feels like a good spot.'],
    how: "Good! Great! I'm at a concert! Me! At a concert!",
    opener: {
      say: 'Um, hi. Do you know if she does an encore? I really, really hope so.',
      replies: [
        { label: 'I think so', end: "Okay. Okay! I'm staying right here then." },
        { label: 'Not sure', end: "Oh no. Okay. I'll just cheer really loud, then." },
      ],
    },
    cheers: 'Cheers! To my first concert!',
    huh: "Sorry, what? It's so loud! Ha. I love it.",
    bye: { walkedOff: 'Okay, bye! Enjoy the show!', timedOut: "Oh, okay. I'll just, um, watch the stage." },
    react: {
      pushed: ["Whoa! Sorry! Wait, you pushed me. I'm trying to see!", 'Dude! I almost missed the chorus!'],
      doused: ['[shocked] Dude! I was filming!', '[groans] My concert shirt! I just bought it!'],
      hit: ["[yelps] Ow! Who threw that? I'm trying to watch!"],
      punched: ["[yelling] OW! Why?! I'm just here for the music!"],
    },
  },
  sal: {
    soon: ["I sang on this Strip forty years, kid. Let's see what this Nixie's got.", 'Is she on yet? In my day, the band warmed up the room first.', 'Chasing Dawn, they tell me. Good title. Strong title.'],
    live: ['[shouting] Atta girl! Sing it, sweetheart!', "[whistles] Now THAT'S a voice!", '[shouting] Brava! BRAVA!', "Listen to that phrasing. The kid's got it."],
    after: ["I'll tell ya, kid. She's the real deal.", "Forty years on this Strip. That one's up there."],
    dj: ['This DJ fella. No band, no horns. But the kids love it.', "Lights like these, I'd have killed for 'em in my day."],
    quips: ['Get up close, kid. You gotta feel a voice like that.', 'Respect the band, kid. They make her sound that good.'],
    how: "Still kickin', kid. Watchin' the new generation do it right.",
    opener: {
      say: 'You know what makes a great singer, kid? Breath. Watch how she breathes.',
      replies: [
        { label: "I'll watch", end: "Good. You'll never hear a song the same way again." },
        { label: 'Just here to dance', end: "Ha! Fair enough. Dance, then. That's what it's for." },
      ],
    },
    cheers: 'To the band, kid.',
    huh: "Eh, can't hear ya over the drums, kid. Good drums, though.",
    bye: { walkedOff: 'Enjoy the show, kid.', timedOut: 'Quiet one. Good. Listen to the music.' },
    react: {
      pushed: ["Hey. Easy. People are listenin' here.", 'Watch it, kid. Respect the show.'],
      doused: ['[growls] In the middle of a song? You got no class, kid.', '[cold] Forty-year-old suit. At a concert. Unbelievable.'],
      hit: ["[angry] You throwin' things at a show? In my day, they'd toss you out."],
      punched: ['[roaring] OW! Not during the song, kid!'],
    },
  },
  margo: {
    soon: ["Darling, is she on yet? I didn't do my hair for nothing.", "They say she opens with Chasing Dawn. Honey, I'm ready.", "A headliner at a pool party. Now THAT'S Vegas, sugar."],
    live: ['[shouting] Work it, darling! WORK IT!', '[cheering] Whooo! Yes, honey!', "[shouting] That's a STAR, everybody!", "Oh, she's got it, darling. She's got the sparkle."],
    after: ["Darling, that was a performance. I'm verklempt.", 'Honey, she gave us everything. Everything!'],
    dj: ['This DJ is divine, darling. I could dance all night.', 'Look at those lights, honey. Somebody knows how to stage a show.'],
    quips: ['Darling, get closer. Stars should be seen up close.', 'Love the energy, sugar. Save some for the chorus.'],
    how: "Darling, I'm at a concert by the pool. I'm fabulous.",
    opener: {
      say: 'Darling, that jacket she wears. Sequins under the follow spot. Genius.',
      replies: [
        { label: 'She looks amazing', end: "Doesn't she? Honey, I used to have a jacket like that." },
        { label: "I'm here for the music", end: 'Oh, the voice too, sugar. But the sparkle helps.' },
      ],
    },
    cheers: 'To the star of the night, darling.',
    huh: "Darling, I can't hear a thing over the band. Isn't it heaven?",
    bye: { walkedOff: 'Enjoy the show, darling!', timedOut: 'Mm. Speechless. I understand, sugar.' },
    react: {
      pushed: ["Excuse me, darling! I'm watching a star!", 'Honey, nobody upstages me. Back up.'],
      doused: ['[outraged] My gown! In front of the stage?!', '[shrieks] Darling, this is a concert, not a car wash!'],
      hit: ["[angry] Who's throwing things at the audience?"],
      punched: ['[shrieking] OW! Not the face! The lights are on me!'],
    },
  },
  priya: {
    soon: ["She's on in a couple of minutes. I've been watching the stage crew.", "I heard she's opening with Chasing Dawn. Best possible opener.", 'Is she on yet? I picked this spot for the sight lines.'],
    live: ['[shouting] Nixie! Yes! YES!', '[cheering] Whooo! Okay, that was perfect!', "[shouting] Chasing Dawn! Let's GO!", "I'm filming this. I'm filming all of this."],
    after: ["Okay, that's officially the best live set I've seen this year.", "I'm already checking when her next set starts."],
    dj: ['The DJ is mixing so clean. Not one beat out of place.', 'These lights are synced to the beat. I checked.'],
    quips: ['Front and centre is the best sound. Trust me, I checked.', "Phones up for the chorus. You'll want the video."],
    how: 'Great. Excellent sight lines, perfect sound. Optimal night.',
    opener: {
      say: "Quick question. Front row or the middle? I'm optimising the experience.",
      replies: [
        { label: 'Front row', end: 'Agreed. Higher energy, worse sound, worth it.' },
        { label: 'The middle', end: "Smart. Better mix. I'll think about it." },
      ],
    },
    cheers: 'To a perfect set. Cheers.',
    huh: "Sorry, the bass is drowning you out. I'll assume yes.",
    bye: { walkedOff: 'Okay, enjoy the set!', timedOut: 'Right, back to the show.' },
    react: {
      pushed: ['Excuse me! You just blocked my shot of the stage.', 'Hey! I was holding this spot!'],
      doused: ['[outraged] My phone! I was recording!', '[angry] Unbelievable. Mid-chorus.'],
      hit: ["[angry] Did you just throw that? I'm filming!"],
      punched: ["[shouting] OW! Are you insane?! There's a show on!"],
    },
  },
  destiny: {
    soon: ['[giggles] Is she on yet? This is my bachelorette and I NEED Nixie!', "Oh my gosh, I heard she's opening with Chasing Dawn! That's our song!", "Girls! Girls! Get to the front! She's coming on!"],
    live: ["[screaming] NIXIE! I'M GETTING MARRIED!", '[squealing] Whooo! Oh my gosh!', '[shouting] I love you, Nixie!', '[singing along] Ohhh, oh-oh! [giggles]'],
    after: ["[giggles] I'm crying. Am I crying? I'm crying.", "That was the best thing that's ever happened! Besides my fiancé. Probably."],
    dj: ["[giggles] This DJ! I can't stop dancing! I'm getting married!", "The lights are so pretty! It's like my wedding but louder!"],
    quips: ['[giggles] Hi! Are you here for Nixie? Come dance with us!', 'Oh my gosh, your outfit is so concert! I love it!'],
    how: "The best! I'm getting married AND I'm at a Nixie Vale show!",
    opener: {
      say: "[giggles] Do you think Nixie would sign my veil? Is that weird? It's weird.",
      replies: [
        { label: 'Not weird', end: "Oh my gosh, yay! I'm gonna wave it during the chorus!" },
        { label: 'A little weird', end: "[giggles] Okay, yeah. I'm still gonna try." },
      ],
    },
    cheers: 'Cheers! To Nixie, and to me getting married!',
    huh: "[giggles] What? It's so loud! I love it!",
    bye: { walkedOff: 'Bye! See you up front!', timedOut: '[giggles] Okay! Back to dancing!' },
    react: {
      pushed: ['Hey! Watch it! You just pushed the bride!', "[gasps] Excuse me! I'm trying to see Nixie!"],
      doused: ['[shrieks] My veil! At the concert!', "[gasps] Oh my gosh! It's my bachelorette!"],
      hit: ['[gasps] Ow! Who threw that at the bride?!'],
      punched: ['[screaming] OW! You hit a bride! At a concert!'],
    },
  },
  eleanor: {
    soon: ['My granddaughter tells me this Nixie Vale is wonderful. We shall see, dear.', 'Is she on yet, dear? My feet are being very patient tonight.', "Chasing Dawn, I'm told. What a lovely title."],
    live: ['[delighted] Oh, bravo! Bravo, dear!', '[laughs] Oh my. Whoo! There, I said it.', 'What a voice. What a lovely voice.', '[shouting] Wonderful! Simply wonderful!'],
    after: ['Well. I may have to buy one of her records, dear.', "I haven't danced like that since nineteen seventy-four."],
    dj: ["The young man at the turntables is rather good, isn't he?", 'Such pretty lights, dear. Like a ballroom under the stars.'],
    quips: ["Do go closer, dear. One isn't young twice.", "Mind the speakers, dear. They're terribly enthusiastic."],
    how: 'Very well, dear. Enjoying a concert, of all things.',
    opener: {
      say: 'Dear, would you tell me which one is the singer? The one in the shiny jacket?',
      replies: [
        { label: "That's her", end: 'Ah! Marvellous. She moves beautifully.' },
        { label: "She's not on yet", end: "Oh, then I'll wait. I've waited for worse things, dear." },
      ],
    },
    cheers: 'To the music, dear.',
    huh: "I'm afraid the drums have the floor, dear. Never mind.",
    bye: { walkedOff: 'Enjoy the music, dear.', timedOut: "Quite right. Let's listen." },
    react: {
      pushed: ["Goodness! Do mind yourself, dear, I'm watching the stage.", "Careful, dear. There's room for everyone at a concert."],
      doused: ['[appalled] During the music! Really, dear!', '[indignant] My silk! At a concert, of all places.'],
      hit: ['[indignant] Was that thrown? At an audience? Shameful.'],
      punched: ['[yelling] OW! Good heavens! Not at a concert!'],
    },
  },
  kayla: {
    soon: ["Oh my gosh, is she on yet? I'm so excited, ya!", "I heard she's opening with Chasing Dawn! I've been playin' it on night shifts all year!", 'Ya, I took a nap this afternoon just for this. Worth it.'],
    live: ['[shouting] NIXIE! Oh my gosh! NIXIE!', '[cheering] Whooo! You betcha!', '[shouting] We love you, Nixie!', '[singing along] Ohhh, oh-oh-oh! [laughs]'],
    after: ['Oh my gosh, hon, I got goosebumps. Look!', "That's goin' in the vacation scrapbook, for sure!"],
    dj: ["Oh, this DJ is so fun! My feet hurt and I don't even care!", "These lights, hon! It's like the northern lights but with a beat!"],
    quips: ["Oh, hi there! Come on up, there's room by the stage!", 'Ya, get your phone out for the chorus, hon!'],
    how: "Oh, the best! First vacation in years and I'm at a concert by a pool!",
    opener: {
      say: "Oh, hi! Is this your first Nixie Vale show? It's mine! Can you tell?",
      replies: [
        { label: 'Mine too', end: "Oh, yay! We're concert buddies now, ya?" },
        { label: 'Seen her before', end: 'Oh, no way! Tell me when to scream, hon!' },
      ],
    },
    cheers: 'Cheers, hon! To the show!',
    huh: "[laughs] Sorry, hon, it's so loud! You betcha!",
    bye: { walkedOff: 'Okay, bye now! Enjoy the show!', timedOut: 'Oh, okay! Back to the music, hon.' },
    react: {
      pushed: ["Oh! Easy there, hon, I'm tryin' to see the stage!", "Whoa! Ya, careful, it's a concert, not a mosh pit!"],
      doused: ["[gasps] Oh, for cryin' out loud! In the middle of the show!", '[shocked] Hon! My concert top!'],
      hit: ["[yelps] Ow! Who's throwin' things at a show?"],
      punched: ['[shouting] OW! Oh my gosh! At a concert?!'],
    },
  },
  rosa: {
    soon: ["Mm. They say she's on soon.", 'Chasing Dawn first, I hear. Good choice.', "Is she on yet? No? Then I'll wait."],
    live: ['[shouting] Nixie! ¡Eso!', '[cheering] Whoo! ¡Vamos!', "Mm. She's the real thing.", '[shouting] ¡Wepa!'],
    after: ["Okay. I'm impressed. Don't tell anyone.", 'Mm. That band is tight.'],
    dj: ['The DJ is good. Not great. Good.', 'Nice lights. Somebody here has taste.'],
    quips: ['Go closer. The sound is better up front.', 'Mm. Enjoy the show, cariño.'],
    how: 'Good. Quiet nights are overrated.',
    opener: {
      say: 'You came for her, or for the pool?',
      replies: [
        { label: 'For her', end: 'Good answer. Get closer, then.' },
        { label: 'For the pool', end: "Mm. Stay for her. You'll see." },
      ],
    },
    cheers: 'Salud. To the singer.',
    huh: "Mm. The music's louder than you. That's fine.",
    bye: { walkedOff: 'Ciao. Enjoy the show.', timedOut: 'Mm. Watch the stage.' },
    react: {
      pushed: ["Careful. I'm watching the show.", "Mm. Push me again and you'll watch from the pool."],
      doused: ['[cold] During the song. Really.', '[annoyed] Ay, cariño. Not at a concert.'],
      hit: ['[cold] You throw things at a concert? Mm.'],
      punched: ['[sharp] OW! ¡Oye! Not during the show!'],
    },
  },
};

/**
 * NIXIE VALE herself, between her sets only (waiting at the back of her stage):
 * about the show, nothing else. On stage she says nothing at all.
 */
export const NIXIE = {
  id: 'nixie',
  name: 'Nixie Vale',
  gender: 'female' as const,
  bio: "NIXIE VALE, the pool stage's headliner: an electropop star in her late twenties (an original character). Warm, quick, a little breathless between sets, all about the show and the people who came to see it.",
  voiceHint: 'young woman in her late twenties, bright, warm, a little husky, energetic pop singer, neutral American',
  /** Said as you pass her between sets. */
  greet: ['Hey! Thanks for coming out tonight!', "We're back on in a few. Don't go anywhere!", 'You guys sound amazing out there. I can hear you from back here!', 'Save your voice for Chasing Dawn, okay?'],
  openers: [
    {
      say: 'Hey! Are you having fun out there? I can see everybody from up here.',
      replies: [
        { label: 'Your show is amazing', end: 'Aw, thank you! Wait till you hear the next set.' },
        { label: 'Can I get a picture?', end: 'After the set, I promise! Come find me by the stage.' },
      ],
    },
    {
      say: "Hi! Any requests? Just kidding, it's always Chasing Dawn. [laughs]",
      replies: [
        { label: 'Play it twice!', end: "[laughs] I'll ask the band. No promises!" },
        { label: 'Love that song', end: 'Me too. It never gets old, singing it for you guys.' },
      ],
    },
  ] as Node[],
  how: "Amazing! A little nervous. That's how you know it's gonna be good.",
  cheers: 'Cheers! To a great show tonight!',
  huh: "Sorry, it's so loud back here! Catch me after the set!",
  bye: { walkedOff: 'See you out front!', timedOut: 'Okay, I gotta warm up. Enjoy the show!' },
  react: {
    pushed: ["Whoa! Careful, I'm on in a few minutes!", 'Easy! Let me get back to the band, okay?'],
    doused: ["[gasps] My stage jacket! I'm on soon!", '[shocked] Oh no, not before the show!'],
    hit: ['[yelps] Ow! Hey, save the throwing for the confetti!'],
    punched: ['[shouting] OW! Security! I have a show to do!'],
  } as Record<PartyReact, string[]>,
};

/** Your crew out at the party (shared by Rocco, Dev and Mikey, each in his own voice). */
export const CREW_PARTY: Record<PartyPhase, string[]> = {
  soon: ["Boys, she's on any minute. Get to the front!", "I heard she's opening with Chasing Dawn. Let's go!", 'Is she on yet? Come on, come on!'],
  live: ["[shouting] NIXIE! Let's GO!", '[cheering] Whooo! This is insane!', 'Phones up, boys! Phones up!'],
  after: ['That was unreal. Absolutely unreal.', 'Best part of the whole trip, no question.'],
  dj: ["This DJ is killing it. We're staying out here.", 'Pool party at night, boys. This is the life.'],
};

/**
 * Words that belong to the casino's floor, not the concert: no party line may
 * use them, and anything else someone at the party would say that does is
 * swapped for a party line (party/partytalk.ts).
 */
export const GAMBLING =
  /\b(bets?|betting|wager\w*|chips?|slots?|tables?|blackjack|roulette|craps|poker|dealers?|casinos?|jackpots?|odds|cards?|dice|gambl\w*|wins?|winning|winnings|winners?|won|lose|losing|losers?|lost|bankroll|croupiers?|stickman|cashier|lucky|luck|money|dollars?|bucks|payouts?|high rollers?|the house|streak|heater|spins?|rolls?|pit boss)\b/i;

/** Every line a conversation tree can say, and every reply label in it. */
export function treeLines(n: Node): { say: string[]; labels: string[] } {
  const say: string[] = [],
    labels: string[] = [];
  const walk = (m: Node) => {
    if (typeof m.say === 'string') say.push(m.say);
    for (const r of m.replies ?? []) {
      labels.push(r.label);
      if (r.end) say.push(r.end);
      if (r.next) walk(r.next);
    }
  };
  walk(n);
  return { say, labels };
}

/** Everything a regular can say at the party (for recording and the tests). */
export function concertLinesOf(set: ConcertSet): string[] {
  return [
    ...set.soon,
    ...set.live,
    ...set.after,
    ...set.dj,
    ...set.quips,
    set.how,
    ...treeLines(set.opener).say,
    set.cheers,
    set.huh,
    set.bye.walkedOff,
    set.bye.timedOut,
    ...Object.values(set.react).flat(),
  ];
}

/** Everything she can say (between sets). */
export function nixieLines(): string[] {
  return [...NIXIE.greet, ...NIXIE.openers.flatMap((n) => treeLines(n).say), NIXIE.how, NIXIE.cheers, NIXIE.huh, NIXIE.bye.walkedOff, NIXIE.bye.timedOut, ...Object.values(NIXIE.react).flat()];
}

/** Your replies in the party's conversations (said out loud in your own voice). */
export function concertReplyLabels(): string[] {
  const out = new Set<string>();
  for (const s of Object.values(CONCERT)) for (const l of treeLines(s.opener).labels) out.add(l);
  for (const n of NIXIE.openers) for (const l of treeLines(n).labels) out.add(l);
  return [...out];
}
