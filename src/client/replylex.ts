/**
 * What else people say when they mean one of the replies on offer (voice
 * replies, see understand.ts). Pure data.
 *
 * `SYNONYMS`: words that mean the same thing anywhere ("dice" is craps, "pigs"
 * are the piggy slots, "bubbly" is champagne). `REPLY_LEX`: for every reply
 * label in the game (dialogueLines.ts OPENERS and the regulars' openers in
 * cast.ts), natural ways of saying it, and whether it agrees or declines
 * (`stance`) so "yes" / "no" find it. A label used in more than one
 * conversation shares its entry, so its phrases suit every place it appears.
 * tests/understand.test.ts checks every label has an entry and every phrase
 * picks its own reply among the replies it's offered with.
 */

/** Groups of words that mean the same thing (the first is the group's name). */
export const SYNONYMS: string[][] = [
  ['craps', 'crap', 'dice', 'die', 'shooter'],
  ['slots', 'slot', 'machine', 'machines', 'pokie', 'pokies', 'bandit', 'bandits'],
  ['piggy', 'pig', 'pigs', 'piggie', 'piggies', 'hog', 'hogs', 'swine', 'piglet', 'piglets'],
  ['roulette', 'wheel'],
  ['blackjack', 'twentyone'],
  ['poker', 'holdem'],
  ['drink', 'drinks', 'cocktail', 'cocktails', 'booze', 'beverage', 'bevvy', 'alcohol'],
  ['beer', 'beers', 'lager', 'brew', 'brewski', 'pint', 'ale'],
  ['champagne', 'bubbly', 'prosecco', 'champers', 'fizz', 'bubbles'],
  ['whiskey', 'whisky'],
  ['lucky', 'luck'],
  ['win', 'winning', 'won', 'winner'],
  ['lose', 'losing', 'lost'],
  ['broke', 'busted', 'bust', 'skint'],
  ['great', 'awesome', 'amazing', 'fantastic', 'incredible', 'wonderful', 'brilliant', 'excellent', 'terrific', 'fabulous', 'epic', 'legendary', 'unreal', 'insane', 'superb', 'phenomenal', 'marvelous', 'marvellous', 'spectacular', 'stellar'],
  ['beautiful', 'gorgeous', 'pretty', 'stunning', 'lovely', 'breathtaking'],
  ['fun', 'blast'],
  ['watch', 'watching', 'look', 'looking', 'browse', 'browsing', 'observe', 'observing', 'spectate', 'spectating'],
  ['tip', 'tips', 'advice', 'pointer', 'pointers', 'hint', 'hints', 'suggestion', 'suggestions'],
  ['rule', 'rules', 'explain', 'instructions'],
  ['bad', 'terrible', 'awful', 'horrible', 'lousy', 'crummy'],
  ['okay', 'ok', 'fine', 'alright'],
  ['recommend', 'suggest', 'recommendation', 'recommendations'],
  ['popular', 'favorite', 'favourite', 'bestseller'],
  ['minimum', 'min', 'limit', 'limits', 'stakes'],
  ['thanks', 'thank', 'thx'],
  ['sorry', 'apologies'],
  ['congratulations', 'congrats', 'congratulation'],
  ['dj', 'deejay', 'music', 'tunes'],
  ['suit', 'swimsuit', 'trunks', 'bikini', 'swimwear'],
  ['espresso', 'expresso'],
];

export interface LexEntry {
  /** Other ways of saying it. */
  also: string[];
  /** Agrees ('yes') or declines ('no'); 'none': never picked by a bare yes/no. */
  stance?: 'yes' | 'no' | 'none';
}

/** Every reply label in the game, by its exact text. */
export const REPLY_LEX: Record<string, LexEntry> = {
  // --- Small talk (dialogueLines.ts) ---------------------------------------
  'Best night ever!': {
    stance: 'yes',
    also: ['great night', 'amazing night', "i'm winning", "i'm up", 'up big', 'feeling lucky', "i'm on fire", 'on a heater', 'crushing it', 'so good', 'having a blast', 'pretty great', 'best night', 'lucky tonight', 'on a roll', 'winning big'],
  },
  "I'm down a bit": {
    stance: 'no',
    also: ["i'm losing", 'losing', 'i lost', 'lost everything', "i'm broke", 'rough night', 'bad night', 'not great', 'not so good', "it's been rough", 'cold streak', "i'm busted", 'down a little', 'lost a bit', 'the tables hate me', 'unlucky', 'could be better', 'not winning', 'getting killed', 'getting crushed', 'taking a beating', 'down bad'],
  },
  'Just looking around': {
    stance: 'none',
    also: ['looking around', 'just browsing', 'exploring', 'checking it out', 'sightseeing', 'just got here', 'taking it in', 'walking around', 'just watching', 'having a look'],
  },
  'Craps table is hot': {
    also: ['craps', 'the craps table', 'the dice table', 'craps is hot', 'shooting dice', 'the pass line', 'try craps', 'craps is where it is at'],
  },
  'Try the piggy slots': {
    also: ['slots', 'the pigs', 'piggy', 'slot machines', 'the pig slots', 'piggy bank', 'the machines', 'pig machine', 'try the slots', 'the slot machine'],
  },
  'Good advice': {
    stance: 'yes',
    also: ["you're right", 'good idea', 'good call', "i'll take a break", 'makes sense', 'great advice', 'smart', 'i need a drink', 'true', 'maybe i will', 'wise words', "that's fair"],
  },
  'One more hand': {
    stance: 'none',
    also: ['one more', 'just one more', "i'm due", "i'll win it back", 'win it back', 'keep playing', 'another hand', 'one more spin', "i can't quit", "i'm not done", 'not yet', 'one more round'],
  },
  'Down the hall, past the elevators': {
    stance: 'none',
    also: ['past the elevators', 'down the hall', 'through the lobby', 'that way', 'out back', 'by the elevators', 'through the hotel', "it's that way", 'over there', 'outside', 'follow the music', 'by the lifts'],
  },
  'No idea, sorry': {
    stance: 'no',
    also: ['no idea', "i don't know", 'sorry', 'not sure', 'no clue', 'beats me', 'dunno', "haven't seen it", 'no sorry', "couldn't tell you"],
  },
  'Have fun!': {
    stance: 'yes',
    also: ['enjoy', 'you too', 'enjoy the party', 'have a good time', 'have a blast', 'good luck', 'enjoy yourself', 'thanks'],
  },
  'Old fashioned': {
    also: ['old fashion', 'an old fashioned', 'whiskey', 'bourbon', 'something strong', 'scotch', 'rye', 'the classic', 'bourbon cocktail', 'whiskey cocktail'],
  },
  'Champagne, obviously': {
    also: ['champagne', 'bubbly', 'prosecco', 'sparkling wine', 'a glass of champagne', 'bubbles', 'the good stuff', 'something sparkling'],
  },
  'Not drinking tonight': {
    stance: 'no',
    also: ['nothing', 'water', 'just water', "i don't drink", "i'm sober", 'sober', 'soda', 'no alcohol', 'not drinking', 'sparkling water', 'nothing for me', 'designated driver', "i'm not drinking"],
  },
  'First time!': {
    stance: 'yes',
    also: ['first time', 'my first time', 'never been', 'never been here', "i'm new", 'brand new', "it's my first", 'first visit', 'my first visit', 'first time ever'],
  },
  'Been here plenty': {
    stance: 'no',
    also: ['many times', 'lots of times', 'every year', "i'm a regular", 'a regular', 'plenty of times', 'been here before', 'loads of times', "i've been before", 'often', 'been plenty', 'i come all the time', 'a bunch', 'been here a bunch', 'a few times', 'second time', 'third time', 'my second time', 'tons of times', 'too many times'],
  },
  'Thanks for the tip': {
    stance: 'yes',
    also: ['thanks', 'thank you', 'will do', "i'll check it out", 'the fountains', 'sounds great', 'good tip', 'great tip', "i'll go see", 'appreciate it'],
  },
  Craps: { also: ['the dice', 'craps table', 'shooting dice', 'pass line', 'dice games', 'i shoot dice'] },
  Roulette: { also: ['the wheel', 'red or black', 'roulette wheel', 'spinning the wheel', 'red', 'black', 'betting on red', 'rule it'] },
  Slots: { also: ['slot machines', 'the machines', 'pokies', 'the pigs', 'piggy', 'one armed bandits', 'video slots', 'pig slots'] },
  'That was me': {
    stance: 'yes',
    also: ['it was me', 'me', 'i won', 'i did it', "that's me", 'guilty', 'i hit it', 'yes me', 'i was the one', 'that guy was me', 'all me', 'i did'],
  },
  'Missed it': {
    stance: 'no',
    also: ["didn't see it", 'i missed it', "i didn't see", 'wish i had', 'i missed that', 'missed that', 'nope missed it', "didn't catch it"],
  },
  'Ha, maybe later': {
    stance: 'no',
    also: ['maybe later', 'later', 'next time', "we'll see", 'another time', 'nice try', 'not now', 'in your dreams', 'maybe'],
  },
  'Sure, why not': {
    stance: 'yes',
    also: ['why not', 'drinks on me', "let's do it", 'you got it', 'deal', "first round's on me", 'of course', "they're on me", 'my treat', 'sure thing'],
  },
  'The DJ is great': {
    stance: 'yes',
    also: ['love the music', 'great music', 'the music is great', "it's insane", 'so much fun', 'great party', 'the dj', 'awesome', 'the dj rocks', 'love it', 'great vibe'],
  },
  "Isn't it late for a pool?": {
    stance: 'no',
    also: ["it's late", 'so late', 'kind of late', 'late for a pool', 'bit late', 'past my bedtime', 'too late', 'what time is it', 'late'],
  },
  "I didn't bring a suit": {
    stance: 'none',
    also: ['no suit', 'no swimsuit', 'no trunks', "i don't have a suit", 'forgot my suit', 'no bathing suit', 'nothing to swim in', "i don't have trunks", 'no swimwear'],
  },
  'Maybe later': {
    stance: 'no',
    also: ['later', 'not now', 'in a bit', 'maybe', 'not tonight', 'another time', 'not right now', 'rain check', 'some other time', "i'll think about it", 'perhaps later'],
  },
  'What should I get?': {
    also: ['what do you recommend', 'recommend something', "what's good", 'what do you suggest', 'what should i order', 'what would you get', 'any suggestions', 'off menu', 'something smoky', 'what should i have'],
  },
  "I'll stick to beer": {
    also: ['beer', 'just beer', 'a beer', 'beer for me', 'i like beer', 'lager', 'keep it simple', "i'm a beer guy", 'a cold one'],
  },
  'Surprise me': {
    also: ["dealer's choice", 'anything', 'whatever you like', 'you pick', 'your choice', 'something good', 'make me something', "bartender's choice", 'whatever', 'up to you', 'impress me', 'you choose', 'your call'],
  },
  "What's popular?": {
    also: ["what's good", 'what do you recommend', 'popular', 'recommendations', "what's your best", 'what do people get', 'best seller', "what's the special", 'specials', 'what do you suggest', "what's your favorite"],
  },
  'Just looking': {
    stance: 'no',
    also: ['nothing', 'nothing yet', 'just browsing', 'not yet', 'in a minute', 'give me a minute', 'still deciding', 'just watching', 'nothing for now', 'looking', "i'm still looking"],
  },
  'Espresso martini': {
    also: ['espresso', 'coffee', 'the espresso one', 'martini', 'coffee martini', 'the coffee one', 'something with coffee'],
  },
  'Yes, please': {
    stance: 'yes',
    also: ['please', 'yes please', 'sure', 'of course', "i'd love some", "don't mind if i do", 'absolutely', 'thank you', 'give me one', 'please do', 'help me', "i'm lost", 'tell me', 'go on', 'lay it on me', "i'd love that", 'champagne'],
  },
  "I'm good, thanks": {
    stance: 'no',
    also: ['no thank you', "i'm fine", 'not for me', "i don't drink", 'pass', 'not tonight', "i'm all set", 'nothing for me', "i'm okay", 'no thanks'],
  },
  "What's the minimum?": {
    also: ['minimum', 'minimum bet', 'how much', 'table limits', "what's the limit", 'how much to play', 'what are the stakes', 'limits', 'the minimum', 'buy in', 'how much is it'],
  },
  'Any tips?': {
    also: ['tips', 'advice', 'any advice', 'how do i win', 'strategy', 'help me win', 'secrets', 'give me a tip', 'got any tips', 'any secrets'],
  },
  'Just watching': {
    stance: 'no',
    also: ['watching', 'just looking', 'not playing', "i'm good", 'just observing', 'not yet', 'in a bit', "i'll watch", 'not now'],
  },
  "What's hitting tonight?": {
    also: ["what's hot", "what's winning", 'hot numbers', "what's coming up", 'any hot numbers', "what's been hitting", 'lucky number', 'what number', "what's hot tonight", "what's lucky"],
  },
  'Explain the table?': {
    also: ['rules', 'the rules', 'how do i play', 'how does it work', 'explain', 'how does this work', 'teach me', 'what are the bets', 'how do i bet', 'explain the rules', 'how do you play'],
  },
  'How do I start?': {
    also: ['how do i play', 'rules', 'the rules', 'how does it work', 'explain', 'teach me', 'what do i do', 'how does this work', 'never played', 'how do you play', 'show me'],
  },
  "Let's go!": {
    stance: 'yes',
    also: ['give me the dice', "let's roll", 'roll', 'let me shoot', "i'll shoot", 'hand them over', "let's do it", 'bring it', 'dice please', 'i want the dice', "let's play", 'let me roll'],
  },
  // --- The regulars (cast.ts) ----------------------------------------------
  'Yeah, feeling lucky': {
    stance: 'yes',
    also: ['feeling lucky', 'i feel lucky', 'lucky', "i'm on a roll", "i'm on fire", "i'm winning", 'winning big', 'feeling great', 'you know it', 'feeling good', "i'm hot tonight"],
  },
  'Not really': {
    stance: 'no',
    also: ['not so much', 'not feeling it', 'not lucky', 'unlucky', "i'm losing", "i'm broke", 'lost everything', 'not at all', 'bad luck', "he's okay", 'not my thing', 'meh', "i don't like him", 'not a fan', 'so so'],
  },
  'Thanks!': {
    stance: 'yes',
    also: ['thank you', 'thanks for the tip', 'good tip', "i'll try it", "i'll try craps", 'will do', 'appreciate it', 'great tip', "i'll check it out", 'thanks a lot'],
  },
  "I'll pass": {
    stance: 'no',
    also: ['pass', 'not for me', "i'll skip it", 'i hate craps', "i don't like craps", 'not my game', 'skip', 'no thanks', 'hard pass'],
  },
  'No way!': {
    stance: 'yes',
    also: ['wow', 'amazing', "that's awesome", 'impressive', 'seriously', 'no kidding', "you're kidding", 'unbelievable', 'good for you', 'nice one', 'i believe you', 'four times', 'incredible', 'get out'],
  },
  'Sure you did': {
    stance: 'no',
    also: ["i don't believe you", 'yeah right', "you're lying", 'whatever', 'i doubt it', 'doubt it', 'prove it', "no you didn't", 'sounds fake', 'liar', 'sure buddy'],
  },
  'No, I\'m good': {
    stance: 'no',
    also: ["i'm fine", 'i know my way', 'i got it', "i'm all set", "i know where i'm going", "i'm not lost", "i'm okay", 'no thanks'],
  },
  'All the time': {
    stance: 'yes',
    also: ['every week', 'i love poker', 'i play a lot', 'constantly', 'every day', "i'm a poker player", 'often', 'i play poker', 'sure do', 'every chance i get'],
  },
  Never: {
    stance: 'no',
    also: ['never played', "i don't play poker", 'not once', 'never have', "i've never played", 'no never', "i don't play"],
  },
  'Yeah, by the bar': {
    stance: 'yes',
    also: ["he's at the bar", 'i saw him at the bar', 'at the bar', 'the bar', 'i saw him', 'drinking at the bar', 'he went that way', 'over at the bar'],
  },
  'No, sorry': {
    stance: 'no',
    also: ["haven't seen him", 'no idea', "i didn't see him", 'sorry', 'no clue', 'not seen him', 'nope sorry'],
  },
  "I'm in": {
    stance: 'yes',
    also: ['count me in', "let's party", 'sounds fun', "i'd love to", 'hell yeah', "i'm down", 'sign me up', "let's do it", "i'll come", "i'll be there", 'party time'],
  },
  Always: {
    stance: 'yes',
    also: ['every night', 'all the time', "it's always like this", 'pretty much', 'always is', 'every single night', 'yeah always', 'twenty four seven', 'every day'],
  },
  "No, it's a big night": {
    stance: 'no',
    also: ['big night', 'special night', "it's busy tonight", 'just tonight', 'tonight is special', 'not usually', "it's a special occasion", 'not always', 'only tonight'],
  },
  "It's double zero": {
    stance: 'no',
    also: ['double zero', 'double', 'two zeros', 'double o', 'american roulette', "it's american", "it's double", 'zero zero'],
  },
  'No idea': {
    stance: 'none',
    also: ["i don't know", 'not sure', 'beats me', 'no clue', 'dunno', 'i have no idea', 'who knows', "couldn't tell you", "haven't checked", 'no idea sorry'],
  },
  'Yes, pretty bad': {
    stance: 'yes',
    also: ['pretty bad', "it's bad", 'terrible', 'awful', "that's high", 'the worst', "it's not great", 'bad odds', 'bad', "that's bad"],
  },
  "No, you'll be fine": {
    stance: 'no',
    also: ["you'll be fine", "it's fine", 'not bad', "don't worry", "it's okay", "you'll be okay", "that's normal", 'just play', 'go for it', 'relax', "it's not that bad"],
  },
  'Totally okay': {
    stance: 'yes',
    also: ["that's okay", "it's okay", "it's normal", 'of course', 'totally normal', 'everyone is', 'me too', "don't worry", "it's fine", "that's fine", 'perfectly fine', 'okay'],
  },
  'Just have fun': {
    stance: 'none',
    also: ['have fun', 'relax', 'enjoy it', 'chill', 'loosen up', 'enjoy yourself', 'just enjoy', 'live a little', "don't overthink it", 'have a good time'],
  },
  Sure: {
    stance: 'yes',
    also: ['of course', 'why not', 'go ahead', 'please do', 'happy to', 'tell me', 'go on', "let's hear it", "i'd love to", 'no problem', 'say cheese', 'okay', 'give me the phone'],
  },
  "He's great": {
    stance: 'yes',
    also: ["he's good", 'love him', 'i love it', "he's amazing", "he's talented", 'great music', 'love the piano', 'beautiful music', 'i like him', "he's awesome", 'i like it'],
  },
  'No thanks': {
    stance: 'no',
    also: ["i'm good", "i'll figure it out", 'not interested', "i'll learn", "i don't need advice", "nah i'm good", 'no thank you', "i'm fine"],
  },
  'Having a blast': {
    stance: 'yes',
    also: ['having fun', 'so much fun', 'great time', 'best time', 'loving it', 'a blast', 'amazing night', 'having the time of my life', 'great night', 'tons of fun'],
  },
  'Not yet': {
    stance: 'no',
    also: ['not really', 'not so far', 'getting there', 'working on it', 'not quite', 'could be better', "it's boring", "haven't played", 'never played it', "haven't tried it", 'not yet no'],
  },
  'Yes, hit': {
    stance: 'yes',
    also: ['hit', 'hit it', 'you hit', 'always hit', 'hit me', 'take a card', 'you should hit', 'hit on sixteen', 'basic strategy says hit'],
  },
  'No, stand': {
    stance: 'no',
    also: ['stand', 'stay', 'you stand', 'stick', "don't hit", 'hold', 'never hit', 'stand on sixteen', 'no stand'],
  },
  'Love the pigs': {
    stance: 'yes',
    also: ['the pigs are great', 'i love it', 'piggy slots', 'so fun', 'the pig game', 'i played it', 'i love that game', 'the blue pig', 'love it', 'the pigs'],
  },
  'Congratulations!': {
    also: ['congrats', 'mazel tov', "that's wonderful", 'how exciting', "that's amazing", 'happy for you', 'best wishes', 'so happy for you', 'congratulations to you', "that's great news"],
  },
  'Best night ever': {
    stance: 'yes',
    also: ['best night', 'having a great night', 'amazing night', 'the best', 'having a blast', 'so much fun', 'great night', 'woo', 'woohoo'],
  },
  'Sorry, no': {
    stance: 'no',
    also: ['sorry', "i can't", 'not now', "i'm busy", "i'd rather not", 'no sorry', 'not right now'],
  },
  'I play': {
    stance: 'yes',
    also: ['i play cards', 'play', "i'm a player", 'i play poker', 'i play blackjack', 'i gamble', 'i do play', 'of course i play', 'i play a little'],
  },
  'I just watch': {
    stance: 'no',
    also: ['watch', 'i watch', 'just watching', "i'm watching", 'just looking', "i don't play", 'spectator', 'i merely watch', 'i just look'],
  },
  "I'd love one": {
    stance: 'yes',
    also: ["i'd love a drink", 'a drink', 'love one', 'that would be lovely', 'how kind', 'drink', 'yes please', 'thank you', "don't mind if i do"],
  },
  "I'm alright": {
    stance: 'no',
    also: ["i'm fine", "i'm okay", 'no thank you', "i'll pass", "i'm not drinking", "i don't drink", "i'm set", 'not for me', 'no thanks'],
  },
  "It's beautiful": {
    stance: 'yes',
    also: ['gorgeous', 'stunning', 'amazing', 'beautiful', 'so pretty', "it's incredible", 'wow', 'love it', 'breathtaking', 'lovely', "it's the prettiest"],
  },
  "It's alright": {
    stance: 'no',
    also: ["it's okay", "it's fine", 'meh', 'not bad', "i've seen better", 'nothing special', 'so so', "it's nice i guess", "it's ok"],
  },
  'Sure, go ahead': {
    stance: 'yes',
    also: ['go ahead', 'sit down', 'take a seat', 'of course', "it's fine", 'nobody will mind', 'why not', 'have a seat', 'totally fine', 'rest your feet'],
  },
  'Better not': {
    stance: 'no',
    also: ["i wouldn't", "don't do that", 'they might kick you out', 'probably not', "i don't think so", 'not a good idea', 'bad idea', "you shouldn't", 'i would not'],
  },
  No: {
    stance: 'no',
    also: ['not counting', "i'm not", 'never', 'of course not', "don't tell me", "i don't want to know", "i'd rather not know", 'keep your secret', 'keep it'],
  },
  Maybe: {
    stance: 'yes',
    also: ['perhaps', 'could be', 'who knows', 'might be', 'possibly', 'a little', 'what if i am', "i'll never tell", 'maybe i am'],
  },
  Yes: {
    stance: 'yes',
    also: ['tell me', 'what is it', 'i want to know', 'go on', 'of course', 'the secret', "what's the secret", 'please tell me'],
  },
};

/** Things people say to a bartender for "whatever you think". */
export const SURPRISE = ['surprise me', "dealer's choice", "bartender's choice", "chef's choice", 'you choose', 'you pick', 'your choice', 'your call', 'up to you', 'whatever you recommend', 'whatever you like', 'something good', 'make me something', 'anything', 'whatever', 'impress me', 'your favorite', 'something special', 'what do you recommend'];

/** Bar Lago's drinks (bar.ts names), by what people call them. */
export const DRINK_ALIASES: Record<string, string[]> = {
  'Lago Spritz': ['spritz', 'aperol', 'aperol spritz', 'spritzer', 'house spritz', 'house cocktail', 'something orange'],
  Negroni: ['negroni', 'campari', 'something bitter'],
  'Dry Martini': ['martini', 'gin martini', 'vodka martini', 'dirty martini', 'shaken not stirred', 'gin'],
  'Espresso Martini': ['espresso', 'espresso martini', 'coffee cocktail', 'coffee martini', 'something with coffee'],
  'Lager on tap': ['beer', 'lager', 'a pint', 'draft', 'draught', 'draft beer', 'a cold one', 'tap beer', 'beer on tap', 'pilsner', 'budweiser', 'bud light', 'brewski'],
  'Hazy IPA': ['ipa', 'i p a', 'hazy', 'craft beer', 'pale ale', 'something hoppy', 'india pale ale'],
  // Not on the menu: an old fashioned is the bourbon (a rocks glass of whiskey).
  'Bourbon, neat': ['bourbon', 'whiskey', 'whiskey neat', 'neat', 'old fashioned', 'old fashion', 'jack daniels', 'straight whiskey', 'bourbon neat'],
  'Scotch on the rocks': ['scotch', 'on the rocks', 'whiskey on the rocks', 'whisky on the rocks', 'single malt', 'scotch whisky', 'scotch on the rocks'],
  'Tequila shot': ['tequila', 'a shot', 'shot of tequila', 'tequila shot', 'patron'],
  'Lemon Drop shot': ['lemon drop', 'lemon shot', 'vodka shot', 'lemon drop shot'],
  Champagne: ['champagne', 'bubbly', 'prosecco', 'sparkling wine', 'glass of bubbly', 'something sparkling', 'wine', 'a glass of wine'],
  'Virgin Mojito': ['mojito', 'virgin mojito', 'mocktail', 'something without alcohol', 'non alcoholic', 'nonalcoholic', 'no alcohol', 'alcohol free', 'something virgin'],
  'Shirley Temple': ['shirley temple', 'shirley', 'grenadine', 'something sweet', 'kiddie cocktail'],
  // The pool bar's frozen drinks.
  'Frozen Margarita': ['margarita', 'frozen margarita', 'marg', 'margarita on the rocks', 'something frozen', 'a frozen drink', 'slushy'],
  'Piña Colada': ['pina colada', 'colada', 'coconut', 'something with coconut', 'something tropical', 'tropical'],
  'Strawberry Daiquiri': ['daiquiri', 'strawberry daiquiri', 'strawberry', 'frozen strawberry', 'something fruity'],
};

/** The Promenade's dishes (promenadeplan.ts names), by what people call them. */
export const FOOD_ALIASES: Record<string, string[]> = {
  'Slice of pepperoni': ['pepperoni', 'pizza', 'a slice', 'slice', 'pepperoni pizza', 'pepperoni slice'],
  'Slice of margherita': ['margherita', 'margarita', 'cheese pizza', 'cheese slice', 'plain slice', 'plain pizza', 'margarita pizza', 'margherita pizza'],
  'Lago double cheeseburger': ['double', 'cheeseburger', 'double cheeseburger', 'burger', 'the double', 'house burger', 'double burger', 'big burger'],
  'Single smash burger': ['smash', 'smash burger', 'single', 'single burger', 'small burger', 'hamburger', 'the single', 'plain burger'],
  'Garlic chili noodles': ['garlic', 'chili', 'spicy', 'spicy noodles', 'noodles', 'chili noodles', 'garlic noodles', 'something spicy'],
  'Sesame beef noodles': ['beef', 'sesame', 'beef noodles', 'sesame noodles', 'sesame beef'],
  'Pistachio gelato cone': ['pistachio', 'gelato', 'ice cream', 'a cone', 'pistachio cone', 'the green one'],
  'Stracciatella gelato cone': ['stracciatella', 'chocolate chip', 'chocolate', 'stracciatella cone', 'choc chip'],
};
