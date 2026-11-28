import { describe, expect, it } from 'vitest';
import { editDistance, intentOf, interpret, matchMenu, menuVocabulary, ordinal, phonetic, placeIn, stance, understand, vocabulary, yesNo, type Understood } from '../src/client/understand';
import { OPENERS, type Node } from '../src/client/dialogueLines';
import { GUESTS, SPEAKERS } from '../src/client/cast';
import { replyLabels, REACTIONS } from '../src/client/reactlines';
import { DRINK_ALIASES, FOOD_ALIASES, REPLY_LEX } from '../src/client/replylex';
import { BAR_MENU, DRINKS, POOL_MENU } from '../src/client/bar';
import { COUNTERS } from '../src/client/areas/promenadeplan';
import { GUEST_TALK, HOW_RECORDED, RUDE_COMEBACKS, STAFF_TALK, STAFF_WHERE, smallTalkLines } from '../src/client/smalltalk';

/** Every set of replies offered anywhere in the game (each node's replies, with siblings). */
function replySets(): { where: string; labels: string[] }[] {
  const out: { where: string; labels: string[] }[] = [];
  const walk = (n: Node, where: string) => {
    if (!n.replies) return;
    out.push({ where, labels: n.replies.map((r) => r.label) });
    for (const r of n.replies) if (r.next) walk(r.next, where + ' > ' + r.label);
  };
  for (const [aud, list] of Object.entries(OPENERS)) list.forEach((n, i) => walk(n, `${aud}#${i}`));
  for (const g of GUESTS) g.openers.forEach((n, i) => walk(n, `${g.id}#${i}`));
  return out;
}

const R = (labels: string[]) => labels.map((label) => ({ label }));

/** Named reply sets for the hand-written cases. */
const C: Record<string, string[]> = {
  waiter: ['Yes, please', "I'm good, thanks"],
  game: ['Craps', 'Roulette', 'Slots'],
  action: ['Craps table is hot', 'Try the piggy slots'],
  night: ['Best night ever!', "I'm down a bit", 'Just looking around'],
  drinkQ: ['Old fashioned', 'Champagne, obviously', 'Not drinking tonight'],
  bartender: ['Surprise me', "What's popular?", 'Just looking'],
  popular: ['Espresso martini', 'Old fashioned'],
  lucky: ['Yeah, feeling lucky', 'Not really'],
  tip: ['Thanks!', "I'll pass"],
  point: ['No way!', 'Sure you did'],
  party: ["I'm in", 'Maybe later'],
  groom: ['Yeah, by the bar', 'No, sorry'],
  edge: ['Yes, pretty bad', "No, you'll be fine"],
  sixteen: ['Yes, hit', 'No, stand'],
  pigs: ['Love the pigs', 'Not yet'],
  bride: ['Congratulations!', 'Best night ever'],
  cards: ['I play', 'I just watch'],
  eleanorDrink: ["I'd love one", "I'm alright"],
  ceiling: ["It's beautiful", "It's alright"],
  sit: ['Sure, go ahead', 'Better not'],
  counting: ['No', 'Maybe'],
  secret: ['Yes', 'No'],
  first: ['First time!', 'Been here plenty'],
  wasMe: ['That was me', 'Missed it'],
  drinksOn: ['Ha, maybe later', 'Sure, why not'],
  pool: ['The DJ is great', "Isn't it late for a pool?"],
  water: ["I didn't bring a suit", 'Maybe later'],
  croupier: ["What's the minimum?", 'Any tips?', 'Just watching'],
  wheel: ["What's hitting tonight?", 'Explain the table?'],
  stick: ['How do I start?', "Let's go!", 'Just watching'],
  advice: ['Good advice', 'One more hand'],
  poolParty: ['Down the hall, past the elevators', 'No idea, sorry'],
  zero: ["It's double zero", 'No idea'],
  enthusiastic: ['Always', "No, it's a big night"],
  poker: ['All the time', 'Never'],
  lost: ['Yes, please', "No, I'm good"],
  piano: ["He's great", 'Not really'],
  fun: ['Having a blast', 'Not yet'],
  scared: ['Totally okay', 'Just have fun'],
  story: ['Sure', 'Maybe later'],
  photo: ['Sure', 'Sorry, no'],
  margo: ['Yes, please', 'No thanks'],
  stick2: ['Thanks for the tip'],
  bar: ['What should I get?', "I'll stick to beer"],
};

type Want = number | null | `intent:${string}`;
/** [reply set, what was heard, what it should mean]. */
const CASES: [string, string, Want][] = [
  // --- Ordinals and positions ---
  ['game', 'the first one', 0],
  ['game', 'first', 0],
  ['game', 'number one', 0],
  ['game', 'option a', 0],
  ['game', 'top', 0],
  ['game', 'the top one', 0],
  ['game', 'one', 0],
  ['game', 'the second one', 1],
  ['game', 'number two', 1],
  ['game', 'option b', 1],
  ['game', 'second', 1],
  ['game', 'the middle one', 1],
  ['game', 'two please', 1],
  ['game', 'the third one', 2],
  ['game', 'option c', 2],
  ['game', 'the last one', 2],
  ['game', 'bottom', 2],
  ['game', "I'll take the last one", 2],
  ['game', 'number 3', 2],
  ['game', 'the 2nd one', 1],
  ['waiter', 'the first one', 0],
  ['waiter', 'the last one', 1],
  ['waiter', 'the second one please', 1],
  ['waiter', 'option x', null],
  ['night', 'option x', 2],
  ['night', "I'll go with the second one", 1],
  ['night', 'the bottom one', 2],
  ['first', 'the first one', 0],
  ['first', 'number two', 1],
  ['drinkQ', 'the middle one', 1],
  ['bartender', 'the first one sounds good', 0],
  ['party', 'the other one', null],
  ['stick', 'the last one', 2],
  // --- Saying the label ---
  ['advice', 'one more hand', 1],
  ['first', 'first time', 0],
  ['first', 'been here plenty', 1],
  ['drinkQ', 'champagne obviously', 1],
  ['drinksOn', 'ha maybe later', 0],
  ['drinksOn', 'sure why not', 1],
  ['poolParty', 'down the hall past the elevators', 0],
  ['pool', "isn't it late for a pool", 1],
  ['croupier', "what's the minimum", 0],
  ['wheel', 'explain the table', 1],
  ['stick', 'how do I start', 0],
  ['stick', "let's go", 1],
  ['point', 'no way', 0],
  ['point', 'sure you did', 1],
  ['zero', "it's double zero", 0],
  ['zero', 'no idea', 1],
  // --- Recognizer slips ---
  ['action', 'crabs table is hot', 0],
  ['action', 'the crabs', 0],
  ['action', 'try the piggie slot', 1],
  ['action', 'piggy slot', 1],
  ['game', 'crabs', 0],
  ['game', 'rule it', 1],
  ['game', 'rule let', 1],
  ['game', 'roulet', 1],
  ['game', 'the slot', 2],
  ['popular', 'expresso martini', 0],
  ['popular', 'espresso martinis', 0],
  ['popular', 'old fashion', 1],
  ['drinkQ', 'champaign', 1],
  ['drinkQ', 'old fashion', 0],
  ['bride', 'congratulation', 0],
  ['bride', 'congrats', 0],
  ['wheel', 'explain the tables', 1],
  ['pigs', 'love the pig', 0],
  ['croupier', 'what is the minimum bet', 0],
  ['bartender', 'surprised me', 0],
  ['ceiling', 'its beautiful', 0],
  ['first', 'first timer', 0],
  ['night', 'best nite ever', 0],
  // --- Synonyms and paraphrases ---
  ['action', 'dice', 0],
  ['action', 'the dice table', 0],
  ['action', 'slots', 1],
  ['action', 'the pigs', 1],
  ['action', 'pigs', 1],
  ['action', 'the slot machines', 1],
  ['game', 'dice', 0],
  ['game', 'I shoot dice', 0],
  ['game', 'the wheel', 1],
  ['game', 'red or black', 1],
  ['game', 'the pigs', 2],
  ['game', 'slot machines', 2],
  ['game', 'I play craps mostly', 0],
  ['night', "I'm broke", 1],
  ['night', 'lost everything', 1],
  ['night', "I'm losing", 1],
  ['night', 'rough night', 1],
  ['night', 'not great', 1],
  ['night', "I'm winning", 0],
  ['night', 'lucky', 0],
  ['night', "I'm up big", 0],
  ['night', 'amazing night', 0],
  ['night', 'just browsing', 2],
  ['night', 'just checking it out', 2],
  ['lucky', 'winning', 0],
  ['lucky', "I'm on a roll", 0],
  ['lucky', 'lucky', 0],
  ['lucky', "I'm broke", 1],
  ['lucky', 'lost everything', 1],
  ['lucky', "I'm not feeling lucky", 1],
  ['drinkQ', 'a cocktail', 0],
  ['drinkQ', 'bubbly', 1],
  ['drinkQ', 'prosecco', 1],
  ['drinkQ', 'whiskey', 0],
  ['drinkQ', 'just water', 2],
  ['drinkQ', "I'm sober", 2],
  ['drinkQ', "I don't drink", 2],
  ['eleanorDrink', "I'd love a cocktail", 0],
  ['eleanorDrink', 'a drink would be lovely', 0],
  ['bartender', "dealer's choice", 0],
  ['bartender', 'whatever you like', 0],
  ['bartender', 'what do you recommend', 1],
  ['bartender', "what's good here", 1],
  ['bartender', 'still deciding', 2],
  ['bartender', 'nothing yet', 2],
  ['popular', 'the coffee one', 0],
  ['popular', 'bourbon', 1],
  ['croupier', 'how much to play', 0],
  ['croupier', 'any advice', 1],
  ['croupier', 'give me a tip', 1],
  ['croupier', 'just looking', 2],
  ['wheel', 'what are the rules', 1],
  ['wheel', 'how do I play', 1],
  ['wheel', "what's hot", 0],
  ['wheel', 'any hot numbers', 0],
  ['stick', 'what are the rules', 0],
  ['stick', 'teach me', 0],
  ['stick', 'give me the dice', 1],
  ['stick', "let's roll", 1],
  ['stick', 'just looking', 2],
  ['groom', "he's at the bar", 0],
  ['groom', "haven't seen him", 1],
  ['bride', 'mazel tov', 0],
  ['bride', "that's wonderful", 0],
  ['bride', 'having a great night', 1],
  ['cards', 'I play poker', 0],
  ['cards', 'just watching', 1],
  ['ceiling', 'gorgeous', 0],
  ['ceiling', 'stunning', 0],
  ['ceiling', "I've seen better", 1],
  ['ceiling', 'meh', 1],
  ['sit', 'take a seat', 0],
  ['sit', 'bad idea', 1],
  ['sixteen', 'hit', 0],
  ['sixteen', 'hit me', 0],
  ['sixteen', 'stand', 1],
  ['sixteen', 'stay', 1],
  ['pigs', 'I love that game', 0],
  ['pool', 'great music', 0],
  ['pool', "it's so late", 1],
  ['water', "I don't have a suit", 0],
  ['water', 'no swimsuit', 0],
  ['water', 'not now', 1],
  ['advice', "you're right", 0],
  ['advice', "I'm due", 1],
  ['advice', 'win it back', 1],
  ['poolParty', 'through the lobby', 0],
  ['poolParty', 'beats me', 1],
  ['zero', 'double zero', 0],
  ['zero', '00', 0],
  ['zero', 'beats me', 1],
  ['enthusiastic', 'every night', 0],
  ['enthusiastic', "it's a special occasion", 1],
  ['poker', 'every week', 0],
  ['poker', 'never played', 1],
  ['edge', 'terrible', 0],
  ['edge', "you'll be fine", 1],
  ['scared', "it's normal", 0],
  ['scared', 'relax and enjoy it', 1],
  ['piano', 'love him', 0],
  ['piano', 'not a fan', 1],
  ['fun', 'so much fun', 0],
  ['fun', 'getting there', 1],
  ['point', 'wow', 0],
  ['point', 'yeah right', 1],
  ['point', "I don't believe you", 1],
  ['wasMe', 'it was me', 0],
  ['wasMe', 'I missed that', 1],
  ['drinksOn', 'drinks on me', 1],
  ['drinksOn', 'next time', 0],
  ['tip', 'appreciate it', 0],
  ['tip', 'not my game', 1],
  ['first', "I've never been here", 0],
  ['first', "I'm new", 0],
  ['first', "I'm a regular", 1],
  ['first', 'lots of times', 1],
  ['counting', 'perhaps', 1],
  ['secret', 'tell me', 0],
  ['bar', 'what do you recommend', 0],
  ['bar', 'a beer', 1],
  ['stick2', 'thanks', 0],
  // --- Negations ---
  ['action', "I don't want to play craps", 1],
  ['action', 'not craps', 1],
  ['action', 'I hate slots', 0],
  ['game', "I don't want to play craps", null],
  ['game', 'not craps, roulette', 1],
  ['game', "I don't play slots", null],
  ['drinkQ', "I don't want champagne", 2],
  ['drinkQ', "I'm not drinking tonight", 2],
  ['sixteen', "don't hit", 1],
  ['sixteen', 'never hit on sixteen', 1],
  ['first', 'not my first time', 1],
  ['pigs', "I haven't played it", 1],
  ['cards', "I don't play", 1],
  ['sit', "you shouldn't", 1],
  ['secret', "don't tell me", 1],
  ['piano', "I don't like him", 1],
  ['edge', "it's not that bad", 1],
  ['edge', 'not bad', 1],
  ['ceiling', 'not bad', 1],
  ['waiter', 'no champagne for me', 1],
  ['lucky', 'not lucky at all', 1],
  ['night', "I'm not winning", 1],
  ['tip', "I don't like craps", 1],
  // --- Yes / no ---
  ['waiter', 'yes', 0],
  ['waiter', 'yeah', 0],
  ['waiter', 'you bet', 0],
  ['waiter', 'hell yeah', 0],
  ['waiter', 'for sure', 0],
  ['waiter', 'sounds good', 0],
  ['waiter', 'why not', 0],
  ['waiter', "don't mind if I do", 0],
  ['waiter', 'absolutely', 0],
  ['waiter', 'sure thing', 0],
  ['waiter', 'maybe', 0],
  ['waiter', 'I guess', 0],
  ['waiter', 'yes please', 0],
  ['waiter', 'thank you', 0],
  ['waiter', 'no', 1],
  ['waiter', 'no thank you', 1],
  ['waiter', 'no thanks', 1],
  ['waiter', 'not tonight', 1],
  ['waiter', "I'll pass", 1],
  ['waiter', 'hard pass', 1],
  ['waiter', 'no way', 1],
  ['waiter', "I'm good", 1],
  ['waiter', "nah I'm alright", 1],
  ['waiter', 'maybe later', 1],
  ['waiter', 'absolutely not', 1],
  ['waiter', 'of course not', 1],
  ['waiter', 'nope', 1],
  ['waiter', "I'm all set", 1],
  ['waiter', "I'd rather not", 1],
  ['waiter', 'not really', 1],
  ['party', 'count me in', 0],
  ['party', "I'm in", 0],
  ['party', "let's do it", 0],
  ['party', 'hell yes', 0],
  ['party', 'sounds fun', 0],
  ['party', 'sure', 0],
  ['party', 'maybe later', 1],
  ['party', 'not tonight', 1],
  ['party', 'nah', 1],
  ['party', "I'll think about it", 1],
  ['story', 'go on then', 0],
  ['story', 'sure why not', 0],
  ['story', 'not now', 1],
  ['photo', 'of course', 0],
  ['photo', 'yeah', 0],
  ['photo', 'sorry', 1],
  ['photo', 'nope', 1],
  ['lost', 'yes please', 0],
  ['lost', "I'm lost", 0],
  ['lost', 'no thank you', 1],
  ['lost', "I know my way", 1],
  ['margo', 'lay it on me', 0],
  ['margo', 'no thanks', 1],
  ['margo', "nah I'm good", 1],
  ['eleanorDrink', 'yes', 0],
  ['eleanorDrink', 'no', 1],
  ['eleanorDrink', "I'm fine", 1],
  ['tip', 'yeah', 0],
  ['tip', 'no', 1],
  ['tip', 'nah', 1],
  ['edge', 'yeah', 0],
  ['edge', 'no', 1],
  ['sixteen', 'yes', 0],
  ['sixteen', 'no', 1],
  ['lucky', 'yes', 0],
  ['lucky', 'nope', 1],
  ['lucky', 'you know it', 0],
  ['first', 'yes', 0],
  ['first', 'no', 1],
  ['wasMe', 'yes', 0],
  ['wasMe', 'no', 1],
  ['drinksOn', 'okay', 1],
  ['drinksOn', 'nah', 0],
  ['sit', 'yeah', 0],
  ['sit', 'probably not', 1],
  ['secret', 'yes', 0],
  ['secret', 'no', 1],
  ['counting', 'no', 0],
  ['counting', 'yes', 1],
  ['ceiling', 'yes', 0],
  ['piano', 'yes', 0],
  ['piano', 'no', 1],
  ['fun', 'yes', 0],
  ['fun', 'no', 1],
  ['pigs', 'yes', 0],
  ['pigs', 'no', 1],
  ['enthusiastic', 'yes', 0],
  ['enthusiastic', 'no', 1],
  ['poker', 'yes', 0],
  ['poker', 'no', 1],
  ['groom', 'yeah', 0],
  ['groom', 'no', 1],
  ['zero', 'no', 0],
  ['zero', 'yes', null],
  ['pool', 'yeah', 0],
  ['water', 'no', 1],
  ['stick', 'yes', 1],
  ['stick', 'sure', 1],
  ['night', 'yes', 0],
  ['night', 'no', 1],
  ['croupier', 'nah', 2],
  ['game', 'yes', null],
  // --- Not a reply: what they were doing ---
  ['waiter', 'hello', 'intent:greet'],
  ['game', 'hey', 'intent:greet'],
  ['game', "what's up", 'intent:greet'],
  ['game', "how's it going", 'intent:greet'],
  ['action', 'good evening', 'intent:greet'],
  ['action', 'howdy', 'intent:greet'],
  ['game', 'thanks', 'intent:thanks'],
  ['game', 'thank you so much', 'intent:thanks'],
  ['game', 'appreciate it', 'intent:thanks'],
  ['waiter', 'goodbye', 'intent:bye'],
  ['waiter', 'see you later', 'intent:bye'],
  ['party', 'gotta go', 'intent:bye'],
  ['night', 'I have to go', 'intent:bye'],
  ['night', 'see ya', 'intent:bye'],
  ['action', 'take care', 'intent:bye'],
  ['action', 'catch you later', 'intent:bye'],
  ['game', 'nice talking to you', 'intent:bye'],
  ['game', 'bye bye', 'intent:bye'],
  ['game', 'good night', 'intent:bye'],
  ['action', 'nice suit', 'intent:compliment'],
  ['action', 'you look great', 'intent:compliment'],
  ['game', 'I love your hat', 'intent:compliment'],
  ['game', "you're funny", 'intent:compliment'],
  ['game', 'looking sharp', 'intent:compliment'],
  ['waiter', "you're annoying", 'intent:insult'],
  ['waiter', 'shut up', 'intent:insult'],
  ['night', 'get lost', 'intent:insult'],
  ['night', 'go away', 'intent:insult'],
  ['game', "you're an idiot", 'intent:insult'],
  ['game', 'leave me alone', 'intent:insult'],
  ['game', 'you look ridiculous', 'intent:insult'],
  ['party', 'nobody asked', 'intent:insult'],
  ['action', "what's your name", 'intent:name'],
  ['action', 'who are you', 'intent:name'],
  ['night', 'what should I call you', 'intent:name'],
  ['action', 'where is the bar', 'intent:where'],
  ['night', "where's the bathroom", 'intent:where'],
  ['night', 'how do I get to the pool', 'intent:where'],
  ['game', 'where can I find roulette', 'intent:where'],
  ['action', 'which way to the elevators', 'intent:where'],
  ['action', "I'm hungry", 'intent:where'],
  ['night', 'is there an arcade', 'intent:where'],
  ['waiter', 'where is the restroom', 'intent:where'],
  ['action', 'cheers', 'intent:cheers'],
  ['night', 'bottoms up', 'intent:cheers'],
  ['night', "here's to you", 'intent:cheers'],
  ['game', 'how are you', 'intent:how'],
  ['game', 'how are you doing', 'intent:how'],
  ['night', 'are you winning', 'intent:how'],
  ['night', 'how about you', 'intent:how'],
  ['action', 'how is your night going', 'intent:how'],
  ['action', 'haha', 'intent:laugh'],
  ['game', 'ha ha ha', 'intent:laugh'],
  ['game', 'lol', 'intent:laugh'],
  ['game', "that's hilarious", 'intent:laugh'],
  // --- Nothing to go on ---
  ['game', 'blah blah', null],
  ['game', 'the weather', null],
  ['waiter', 'um', null],
  ['night', 'purple monkey dishwasher', null],
];


/**
 * A second batch, written after the first passed and run once before any
 * tuning (recognizer-style text: no punctuation, odd spellings, run-ons). That
 * first run got 126/131 (96.2%); the five misses ("getting killed", "been here
 * a bunch", "my third time", "maybe later man" read as goodbye, "hey whats up"
 * read as a reply) were then fixed in the lexicon and rules.
 */
const HELD_OUT: [string, string, Want][] = [
  ['night', 'yeah its been a great night', 0],
  ['night', 'honestly pretty good so far', 0],
  ['night', 'im getting killed out there', 1],
  ['night', 'kind of a rough one', 1],
  ['night', 'i just walked in', 2],
  ['night', 'just having a look', 2],
  ['night', 'oh man i lost so much money', 1],
  ['night', 'crushing it baby', 0],
  ['action', 'go shoot some dice', 0],
  ['action', 'the craps table for sure', 0],
  ['action', 'try those pig machines', 1],
  ['action', 'the piggy bank slot', 1],
  ['action', 'crap table', 0],
  ['action', 'go play the slot machines', 1],
  ['advice', 'yeah maybe ill take a break', 0],
  ['advice', 'nah just one more hand', 1],
  ['advice', 'thats smart', 0],
  ['advice', 'i feel like im due', 1],
  ['poolParty', 'its down the hall', 0],
  ['poolParty', 'i have no idea sorry', 1],
  ['poolParty', 'go past the elevators', 0],
  ['poolParty', 'not sure', 1],
  ['drinkQ', 'an old-fashioned', 0],
  ['drinkQ', 'champagne of course', 1],
  ['drinkQ', 'im not drinking', 2],
  ['drinkQ', 'nothing tonight', 2],
  ['drinkQ', 'whisky', 0],
  ['first', 'yeah first time here', 0],
  ['first', 'ive been here a bunch', 1],
  ['first', 'this is my third time', 1],
  ['first', 'its my first time in vegas', 0],
  ['game', 'mostly craps', 0],
  ['game', 'i like roulette', 1],
  ['game', 'the slot machines mostly', 2],
  ['game', 'roulette for sure', 1],
  ['game', 'crabs mostly', 0],
  ['wasMe', 'yep that was me', 0],
  ['wasMe', 'no i missed it', 1],
  ['wasMe', 'guilty as charged', 0],
  ['drinksOn', 'sure the first rounds on me', 1],
  ['drinksOn', 'haha maybe later', 0],
  ['drinksOn', 'nice try', 0],
  ['pool', 'the dj is amazing', 0],
  ['pool', 'isnt it kind of late', 1],
  ['water', 'i dont have a swimsuit', 0],
  ['water', 'maybe in a bit', 1],
  ['bar', 'what would you recommend', 0],
  ['bar', 'im just gonna have a beer', 1],
  ['bartender', 'surprise me please', 0],
  ['bartender', 'whats popular here', 1],
  ['bartender', 'what do people usually get', 1],
  ['bartender', 'im just looking thanks', 2],
  ['bartender', 'give me a minute', 2],
  ['popular', 'ill have the espresso martini', 0],
  ['popular', 'the old fashioned please', 1],
  ['waiter', 'sure why not', 0],
  ['waiter', 'oh yes please', 0],
  ['waiter', 'no im good thanks', 1],
  ['waiter', 'not right now', 1],
  ['waiter', 'nah', 1],
  ['croupier', 'whats the minimum here', 0],
  ['croupier', 'got any tips for me', 1],
  ['croupier', 'im just watching', 2],
  ['wheel', 'whats been hitting', 0],
  ['wheel', 'can you explain how it works', 1],
  ['stick', 'how do i play this', 0],
  ['stick', 'lets go baby', 1],
  ['stick', 'yeah give me the dice', 1],
  ['stick', 'no im just watching', 2],
  ['lucky', 'oh yeah im feeling lucky', 0],
  ['lucky', 'not really no', 1],
  ['tip', 'thanks man', 0],
  ['tip', 'ill pass', 1],
  ['point', 'no way thats amazing', 0],
  ['point', 'yeah sure you did', 1],
  ['lost', 'yes please im so lost', 0],
  ['lost', 'no im good', 1],
  ['poker', 'all the time', 0],
  ['poker', 'never in my life', 1],
  ['groom', 'yeah i think hes at the bar', 0],
  ['groom', 'no sorry havent seen him', 1],
  ['party', 'yeah im in', 0],
  ['party', 'maybe later man', 1],
  ['enthusiastic', 'always', 0],
  ['enthusiastic', 'no its a big night tonight', 1],
  ['zero', 'its a double zero wheel', 0],
  ['zero', 'i have no clue', 1],
  ['edge', 'yeah thats pretty bad', 0],
  ['edge', 'nah youll be fine', 1],
  ['scared', 'totally fine', 0],
  ['scared', 'just have some fun', 1],
  ['story', 'sure tell me', 0],
  ['piano', 'hes really good', 0],
  ['piano', 'not really my thing', 1],
  ['margo', 'please do', 0],
  ['fun', 'having a blast', 0],
  ['fun', 'not yet but soon', 1],
  ['sixteen', 'you gotta hit', 0],
  ['sixteen', 'i would stand', 1],
  ['pigs', 'i love those pigs', 0],
  ['pigs', 'havent tried it yet', 1],
  ['bride', 'oh congratulations', 0],
  ['bride', 'best night ever', 1],
  ['photo', 'sure no problem', 0],
  ['photo', 'sorry i cant', 1],
  ['cards', 'i play a bit', 0],
  ['cards', 'i mostly just watch', 1],
  ['eleanorDrink', 'id love one', 0],
  ['eleanorDrink', 'im alright thank you', 1],
  ['ceiling', 'its gorgeous', 0],
  ['ceiling', 'its okay i guess', 1],
  ['sit', 'sure go ahead', 0],
  ['sit', 'id better not', 1],
  ['counting', 'maybe', 1],
  ['counting', 'no im not', 0],
  ['secret', 'yeah tell me', 0],
  ['secret', 'nah keep it', 1],
  ['game', 'see you later', 'intent:bye'],
  ['night', 'hey whats up', 'intent:greet'],
  ['night', 'whats your name', 'intent:name'],
  ['night', 'where are the bathrooms', 'intent:where'],
  ['night', 'where can i get some food', 'intent:where'],
  ['game', 'you are so annoying', 'intent:insult'],
  ['game', 'nice jacket', 'intent:compliment'],
  ['game', 'cheers mate', 'intent:cheers'],
  ['game', 'how you doing', 'intent:how'],
  ['game', 'hahaha', 'intent:laugh'],
  ['game', 'thanks a lot', 'intent:thanks'],
  ['game', 'gotta run', 'intent:bye'],
  ['game', 'where is the elevator', 'intent:where'],
  ['game', 'who am i talking to', 'intent:name'],
];

const intentName = (u: Understood | null) => (u === null ? null : 'reply' in u ? u.reply : `intent:${u.intent.kind}`);

describe('understanding voice replies', () => {
  it('has a lexicon entry for every reply label in the game', () => {
    const missing = replyLabels().filter((l) => !REPLY_LEX[l]);
    expect(missing).toEqual([]);
    const unused = Object.keys(REPLY_LEX).filter((l) => !replyLabels().includes(l));
    expect(unused).toEqual([]);
  });

  it('picks every reply by its own label, everywhere it is offered', () => {
    for (const { where, labels } of replySets())
      labels.forEach((l, i) => expect([where, l, intentName(understand(l, R(labels)))]).toEqual([where, l, i]));
  });

  it('picks every reply by each of its paraphrases, among the replies it is offered with', () => {
    let n = 0;
    const wrong: string[] = [];
    for (const { where, labels } of replySets())
      labels.forEach((l, i) => {
        for (const p of REPLY_LEX[l].also) {
          n++;
          const got = intentName(understand(p, R(labels)));
          if (got !== i) wrong.push(`${where}: "${p}" -> ${got} (want ${i} "${l}")`);
        }
      });
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(700);
  });

  it('understands hundreds of utterances (accuracy)', () => {
    const wrong: string[] = [];
    for (const [ctx, said, want] of CASES) {
      const got = intentName(understand(said, R(C[ctx])));
      if (got !== want) wrong.push(`[${ctx}] "${said}" -> ${got} (want ${want})`);
    }
    const accuracy = 1 - wrong.length / CASES.length;
    console.log(`understand: ${CASES.length - wrong.length}/${CASES.length} hand-written utterances right (${(accuracy * 100).toFixed(1)}%)`);
    if (wrong.length) console.log(wrong.join('\n'));
    expect(CASES.length).toBeGreaterThan(300);
    expect(accuracy).toBeGreaterThanOrEqual(0.97);
  });

  it('understands a second batch (first run 96.2%, see HELD_OUT)', () => {
    const wrong: string[] = [];
    for (const [ctx, said, want] of HELD_OUT) {
      const got = intentName(understand(said, R(C[ctx])));
      if (got !== want) wrong.push(`[${ctx}] "${said}" -> ${got} (want ${want})`);
    }
    const accuracy = 1 - wrong.length / HELD_OUT.length;
    console.log(`understand (held out): ${HELD_OUT.length - wrong.length}/${HELD_OUT.length} right (${(accuracy * 100).toFixed(1)}%)`);
    if (wrong.length) console.log(wrong.join('\n'));
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('reads the browser recognizer alternatives in order', () => {
    expect(interpret('crumbs | craps | crabs', R(C.game))).toBe(0);
    expect(intentName(understand('cheese | cheers', R(C.game)))).toBe('intent:cheers');
    expect(interpret('', R(C.game))).toBeNull();
  });

  it('hears yes and no', () => {
    for (const y of ['yeah sure', 'yes please', 'uh huh', 'you bet', 'hell yeah', 'for sure', 'count me in', 'sounds good', "I'm in", 'why not', "let's do it", 'maybe', 'I guess', 'not bad', 'no problem', 'go for it', 'absolutely'])
      expect([y, yesNo(y)]).toEqual([y, 'yes']);
    for (const n of ['no thanks', "nah I'm good", 'not really', 'not tonight', "I'll pass", 'hard pass', 'no way', "I'm good", "nah I'm alright", 'maybe later', 'of course not', 'I guess not', 'nope', 'count me out', 'never'])
      expect([n, yesNo(n)]).toEqual([n, 'no']);
    for (const x of ['the weather', "I don't know", 'not sure']) expect(yesNo(x)).toBeNull();
  });

  it('reads reply labels', () => {
    expect(stance('Yes, please')).toBe('yes');
    expect(stance("I'm good, thanks")).toBe('no');
    expect(stance('Maybe later')).toBe('no');
    expect(stance('Craps')).toBeNull();
    expect(stance('No idea')).toBeNull();
  });

  it('every yes/no question in the game has a yes and a no', () => {
    for (const { labels } of replySets()) {
      if (labels.length !== 2) continue;
      const y = interpret('yes', R(labels)),
        no = interpret('no', R(labels));
      if (y !== null || no !== null) expect(y).not.toBe(no);
    }
  });

  it('reads positions only when that is all you said', () => {
    expect(ordinal('the first one', 3)).toBe(0);
    expect(ordinal('first time', 2)).toBeNull();
    expect(ordinal('one more hand', 2)).toBeNull();
    expect(ordinal('the third one', 2)).toBeNull();
    expect(ordinal('the middle one', 2)).toBeNull();
  });

  it('matches sounds and slips', () => {
    expect(phonetic('craps')).toBe(phonetic('crabs'));
    expect(phonetic('roulette')).toBe(phonetic('ruleit'));
    expect(editDistance('martini', 'martinis')).toBe(1);
    expect(editDistance('espresso', 'expresso')).toBe(1);
  });

  it('knows where you want to go', () => {
    expect(placeIn('where is the bar')).toBe('bar');
    expect(placeIn("where's the men's room")).toBe('bathroom');
    expect(placeIn('which way to the lifts')).toBe('elevator');
    expect(placeIn('is there a food court')).toBe('food');
    expect(placeIn('where do I play blackjack')).toBe('blackjack');
    expect(placeIn('where can I cash out')).toBe('cashier');
    expect(intentOf('where is the arcade')).toEqual({ kind: 'where', place: 'arcade' });
    expect(intentOf('where am I')).toEqual({ kind: 'where', place: undefined });
  });

  it('keeps the offline vocabulary small', () => {
    let most = 0;
    for (const { labels } of replySets()) most = Math.max(most, vocabulary(R(labels)).length);
    expect(most).toBeLessThan(450);
    const v = vocabulary(R(C.action));
    for (const w of ['craps', 'dice', 'pigs', 'first', 'second', 'last', 'cheers', 'bye', 'name', 'bathroom', 'yes', 'nope']) expect(v).toContain(w);
    expect(menuVocabulary(BAR_MENU.map((d) => d.name), DRINK_ALIASES).length).toBeLessThan(250);
  });
});

describe('ordering by voice', () => {
  const names = BAR_MENU.map((d) => d.name);
  const drink = (said: string) => {
    const m = matchMenu(said, names, DRINK_ALIASES);
    return typeof m === 'number' ? names[m] : m;
  };

  it('every drink alias is a real drink on a bar menu (Bar Lago or the pool bar)', () => {
    const either = [...names, ...POOL_MENU.map((d) => d.name)];
    for (const k of Object.keys(DRINK_ALIASES)) expect(either).toContain(k);
    for (const d of DRINKS.filter((d) => !d.offMenu)) expect(DRINK_ALIASES[d.name]).toBeDefined();
  });

  const DRINK_CASES: [string, string | null][] = [
    ['can I get an old fashioned', 'Bourbon, neat'],
    ['a beer please', 'Lager on tap'],
    ['surprise me', 'surprise'],
    ["bartender's choice", 'surprise'],
    ['whatever you recommend', 'surprise'],
    ['negroni', 'Negroni'],
    ["I'll have a negroni please", 'Negroni'],
    ['martini', 'Dry Martini'],
    ['a dry martini', 'Dry Martini'],
    ['espresso martini', 'Espresso Martini'],
    ['expresso martini', 'Espresso Martini'],
    ['give me an IPA', 'Hazy IPA'],
    ['hazy IPA', 'Hazy IPA'],
    ['a pint', 'Lager on tap'],
    ['lager', 'Lager on tap'],
    ['bourbon neat', 'Bourbon, neat'],
    ['whiskey', 'Bourbon, neat'],
    ['scotch on the rocks', 'Scotch on the rocks'],
    ['whiskey on the rocks', 'Scotch on the rocks'],
    ['a shot of tequila', 'Tequila shot'],
    ['tequila', 'Tequila shot'],
    ['lemon drop', 'Lemon Drop shot'],
    ['glass of champagne', 'Champagne'],
    ['bubbly', 'Champagne'],
    ['a glass of wine', 'Champagne'],
    ['virgin mojito', 'Virgin Mojito'],
    ['a mojito', 'Virgin Mojito'],
    ['something without alcohol', 'Virgin Mojito'],
    ['shirley temple', 'Shirley Temple'],
    ['aperol spritz', 'Lago Spritz'],
    ['the lago spritz', 'Lago Spritz'],
    ['spritz', 'Lago Spritz'],
    ['can I get a negroni | can I get a nachos', 'Negroni'],
    ['no thanks', null],
    ['nothing for me', null],
    ['what time is it', null],
    ["I don't want a beer", null],
  ];
  it.each(DRINK_CASES)('"%s" at the bar', (said, want) => expect(drink(said)).toBe(want));

  const poolNames = POOL_MENU.map((d) => d.name);
  const POOL_CASES: [string, string | null][] = [
    ['can I get a beer', 'Lager on tap'],
    ['a frozen margarita please', 'Frozen Margarita'],
    ['margarita', 'Frozen Margarita'],
    ["I'll have a pina colada", 'Piña Colada'],
    ['strawberry daiquiri', 'Strawberry Daiquiri'],
    ['something frozen', 'Frozen Margarita'],
    ['an IPA', 'Hazy IPA'],
    ['surprise me', 'surprise'],
    ['no thanks', null],
  ];
  it.each(POOL_CASES)('"%s" at the pool bar', (said, want) => {
    const m = matchMenu(said, poolNames, DRINK_ALIASES);
    expect(typeof m === 'number' ? poolNames[m] : m).toBe(want);
  });

  it('the pool bar serves beer, frozen drinks and cocktails, all real drinks', () => {
    expect(POOL_MENU.every((d) => DRINKS.includes(d) && !d.offMenu)).toBe(true);
    for (const s of ['Beer', 'Frozen', 'Cocktails'] as const) expect(POOL_MENU.some((d) => d.section === s)).toBe(true);
    // Bar Lago's menu doesn't list the frozen drinks.
    expect(BAR_MENU.some((d) => d.frozen)).toBe(false);
  });

  it('every dish alias is a real dish, and names a dish at its own counter', () => {
    for (const c of COUNTERS) {
      const names = c.items.map((i) => i.name);
      c.items.forEach((it, i) => {
        expect(matchMenu(it.name, names, FOOD_ALIASES)).toBe(i);
        for (const a of FOOD_ALIASES[it.name] ?? []) expect([c.id, a, matchMenu(a, names, FOOD_ALIASES)]).toEqual([c.id, a, i]);
      });
    }
  });

  const FOOD_CASES: [string, string, string | null][] = [
    ['pizza', 'a slice of pepperoni please', 'Slice of pepperoni'],
    ['pizza', 'can I get a margarita', 'Slice of margherita'],
    ['pizza', 'cheese pizza', 'Slice of margherita'],
    ['pizza', 'pizza', 'Slice of pepperoni'],
    ['burger', 'a burger please', 'Lago double cheeseburger'],
    ['burger', 'double cheeseburger', 'Lago double cheeseburger'],
    ['burger', 'just a single smash burger', 'Single smash burger'],
    ['burger', 'hamburger', 'Single smash burger'],
    ['noodles', 'the spicy noodles', 'Garlic chili noodles'],
    ['noodles', 'beef noodles please', 'Sesame beef noodles'],
    ['gelato', 'pistachio', 'Pistachio gelato cone'],
    ['gelato', 'chocolate chip', 'Stracciatella gelato cone'],
    ['gelato', 'an ice cream', 'Pistachio gelato cone'],
    ['gelato', 'no thanks', null],
  ];
  it.each(FOOD_CASES)('at the %s counter: "%s"', (counter, said, want) => {
    const c = COUNTERS.find((x) => x.id === counter)!;
    const names = c.items.map((i) => i.name);
    const m = matchMenu(said, names, FOOD_ALIASES, []);
    expect(typeof m === 'number' ? names[m] : m).toBe(want);
  });
});

describe('small talk lines', () => {
  it('every regular has a name, how-are-you and where line, and staff have theirs', () => {
    for (const g of GUESTS) expect(GUEST_TALK[g.id]).toBeDefined();
    for (const id of ['bartender', 'waiter', 'waitress', 'croupier', 'stickman', 'dealer']) {
      expect(STAFF_TALK[id as keyof typeof STAFF_TALK]).toBeDefined();
      expect(SPEAKERS.some((s) => s.id === id)).toBe(true);
    }
    for (const p of ['bar', 'craps', 'roulette', 'blackjack', 'pool', 'bathroom', 'elevator', 'arcade', 'food']) expect(STAFF_WHERE[p as keyof typeof STAFF_WHERE]).toBeTruthy();
    const { guests, staff } = smallTalkLines();
    expect(Object.keys(guests).length).toBe(GUESTS.length);
    expect(Object.keys(staff).length).toBe(6);
  });

  it('insult comebacks and reused lines are lines the speakers already have', () => {
    for (const [id, list] of Object.entries(RUDE_COMEBACKS)) {
      expect(list.length).toBeGreaterThan(0);
      for (const l of list) expect([id, l.text, REACTIONS[id]?.[l.kind]?.includes(l.text)]).toEqual([id, l.text, true]);
    }
    for (const g of GUESTS) expect(RUDE_COMEBACKS[g.id]).toBeDefined();
    for (const [id, list] of Object.entries(HOW_RECORDED)) {
      const g = GUESTS.find((x) => x.id === id)!;
      for (const t of list) expect(g.quips).toContain(t);
    }
  });
});
