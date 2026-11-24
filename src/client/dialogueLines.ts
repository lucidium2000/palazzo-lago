/**
 * What people say. Ambient exchanges are short scenes between guests standing
 * together (speaker index into the group, the line, and whether everyone
 * laughs after it). Player conversations are small branching trees.
 */

export type Turn = [speaker: number, line: string, laugh?: boolean];

export interface Exchange {
  /** How many different speakers the scene needs. */
  cast: number;
  turns: Turn[];
}

export const EXCHANGES: Exchange[] = [
  // Who's winning
  { cast: 2, turns: [[0, "How are you doing tonight?"], [1, "Up three hundred on blackjack. Down four on craps."], [0, "So, down a hundred."], [1, "Don't say it like that.", true]] },
  { cast: 2, turns: [[0, "Did you see that guy at roulette?"], [1, "The one who hit seventeen twice?"], [0, "Three times! Straight up!"], [1, "I'm betting seventeen next."]] },
  { cast: 3, turns: [[0, "I'm telling you, the dealer at table four is cold."], [1, "You just don't know when to stop."], [2, "He never knows when to stop.", true]] },
  { cast: 2, turns: [[0, "I hit a slot bonus on the piggy machine."], [1, "How much?"], [0, "Forty dollars."], [1, "Living large!", true]] },
  { cast: 2, turns: [[0, "What's your system for craps?"], [1, "Pass line, take the odds, pray."], [0, "That's a system?"], [1, "It's worked for thirty years.", true]] },
  { cast: 3, turns: [[0, "Okay, one more hand and then dinner."], [1, "You said that an hour ago."], [2, "Two hours ago."], [0, "Then I'm due!", true]] },
  { cast: 2, turns: [[0, "I just watched a lady win twelve grand on a penny slot."], [1, "Penny slot? On what bet?"], [0, "Max bet. Six bucks a spin."], [1, "Where is that machine?"]] },
  { cast: 2, turns: [[0, "Never split tens. Never."], [1, "I split tens."], [0, "And?"], [1, "Lost both.", true]] },
  // Shows and plans
  { cast: 2, turns: [[0, "What time is the show?"], [1, "Ten thirty. We have time for one more drink."], [0, "Or two."], [1, "Or two.", true]] },
  { cast: 3, turns: [[0, "Are we doing the water show or the magician?"], [1, "The magician. My cousin saw it, said it's unreal."], [2, "Your cousin thinks everything is unreal."], [1, "Fair.", true]] },
  { cast: 2, turns: [[0, "We should go out on the terrace for the fountains."], [1, "When's the next one?"], [0, "Every fifteen minutes, I think."], [1, "Let's finish these first."]] },
  { cast: 2, turns: [[0, "The pool party's going till two."], [1, "At night? Is the pool even open?"], [0, "It's Vegas. Everything's open."]] },
  { cast: 3, turns: [[0, "Steakhouse or the buffet?"], [1, "Buffet. Crab legs."], [2, "Steakhouse. I'm not fighting a grandma for crab legs again."], [1, "She started it.", true]] },
  { cast: 2, turns: [[0, "I booked the tasting menu for nine."], [1, "Fancy. Are we dressing up?"], [0, "You are already dressed up."], [1, "This is my lucky shirt."]] },
  { cast: 2, turns: [[0, "Did you get tickets for the concert?"], [1, "Sold out. We'll find something better."], [0, "In Vegas, there's always something better."]] },
  // The place
  { cast: 2, turns: [[0, "Look at this ceiling. All glass."], [1, "Hand blown, every flower."], [0, "How do they even clean that?"], [1, "Very carefully.", true]] },
  { cast: 2, turns: [[0, "This carpet is wild."], [1, "It's supposed to keep you awake."], [0, "It's working."]] },
  { cast: 3, turns: [[0, "Have you been up to the suites?"], [1, "We're on thirty two. The view of the Strip is insane."], [2, "We're on six. We see a parking lot."], [0, "A very nice parking lot.", true]] },
  { cast: 2, turns: [[0, "These drinks are strong."], [1, "That's the point, honey."], [0, "I'm cutting myself off after this one."], [1, "Sure you are.", true]] },
  { cast: 2, turns: [[0, "The bartender made me something with gold flakes in it."], [1, "Was it good?"], [0, "It was twenty six dollars."], [1, "So, no.", true]] },
  // Celebrity sightings
  { cast: 2, turns: [[0, "Don't look, but I think that's a basketball player by the bar."], [1, "Which one?"], [0, "The tall one."], [1, "They're all tall.", true]] },
  { cast: 3, turns: [[0, "I swear I saw a famous chef at the steakhouse."], [1, "You said that last year."], [2, "Last year it was a waiter."], [0, "A very famous-looking waiter.", true]] },
  // Couples and friends
  { cast: 2, turns: [[0, "Are you having fun?"], [1, "Best weekend in years."], [0, "Even with my snoring?"], [1, "I bought earplugs.", true]] },
  { cast: 2, turns: [[0, "Remind me how much we budgeted?"], [1, "We passed the budget yesterday."], [0, "Then it's not a budget, it's a suggestion."]] },
  { cast: 2, turns: [[0, "Happy anniversary, by the way."], [1, "Ten years. And you brought me to a casino."], [0, "You love casinos."], [1, "I do love casinos."]] },
  { cast: 3, turns: [[0, "Bachelor party's at the pool later."], [1, "Is Mike still asleep?"], [2, "Mike lost his shoes."], [0, "Again?", true]] },
  { cast: 2, turns: [[0, "Text the group, we're at the bar."], [1, "Which bar? There are five."], [0, "The one with the piano."]] },
  // Small talk
  { cast: 2, turns: [[0, "Where are you guys from?"], [1, "Chicago. You?"], [0, "Dallas. First time here?"], [1, "Third. Can't stay away."]] },
  { cast: 2, turns: [[0, "It's a hundred and four outside."], [1, "Dry heat, though."], [0, "So is an oven.", true]] },
  { cast: 3, turns: [[0, "What did everyone win today?"], [1, "A free drink."], [2, "A stomach ache from the buffet."], [0, "Winners all around.", true]] },
  { cast: 2, turns: [[0, "I need coffee."], [1, "It's midnight."], [0, "Exactly. The night's just starting."]] },
  { cast: 2, turns: [[0, "Have you tried the new piggy bank slot?"], [1, "The one with the fat pigs?"], [0, "Wait until the blue one is huge. Trust me."]] },
];

/** Passing chats between two people who meet on the floor. */
export const PASSING: Exchange[] = [
  { cast: 2, turns: [[0, "Hey! Fancy seeing you here."], [1, "Small world. You winning?"], [0, "Don't ask.", true]] },
  { cast: 2, turns: [[0, "Have you seen the bathrooms?"], [1, "Past the slots, on the left."], [0, "Thanks!"]] },
  { cast: 2, turns: [[0, "Nice jacket."], [1, "Thanks, it's rented.", true]] },
  { cast: 2, turns: [[0, "Is the pool open?"], [1, "Through the hotel lobby, past the elevators."]] },
  { cast: 2, turns: [[0, "Excuse me, which way to the cashier?"], [1, "Over by the entrance. Cashing out?"], [0, "Cashing in. Again.", true]] },
];

/** Overheard when someone near them wins big. */
export const WIN_REACTIONS = ["Whoa! Did you see that?", "Somebody's having a night!", "Lucky!", "That's the guy from before!", "Teach me your ways!"];

// --- Talking with the player --------------------------------------------------------

export interface Ctx {
  chips: number;
  up: number;
  drink: boolean;
  name: string;
}

export interface Reply {
  label: string;
  next?: Node;
  /** The NPC's last line when the conversation ends on this reply. */
  end?: string;
}

export interface Node {
  say: string | ((c: Ctx) => string);
  replies?: Reply[];
}


export type Audience = 'guest' | 'pool' | 'bar' | 'croupier' | 'bartender' | 'waiter' | 'dealer-craps' | 'dealer-roulette';

export const OPENERS: Record<Audience, Node[]> = {
  guest: [
    {
      say: (c) => (c.up > 300 ? "You look like you're on a heater. Up big tonight?" : c.up < -300 ? "Rough night at the tables? Happens to all of us." : 'Hey there! Having a good night?'),
      replies: [
        { label: 'Best night ever!', next: { say: "That's what I like to hear. Where's the action?", replies: [{ label: 'Craps table is hot', end: "Then that's where I'm headed. Good luck!" }, { label: 'Try the piggy slots', end: "The pigs? Alright, I'll give it a shot!" }] } },
        { label: "I'm down a bit", next: { say: "Take a break, get a drink, come back fresh. Works for me every time.", replies: [{ label: 'Good advice', end: 'Hang in there. The night is young!' }, { label: 'One more hand', end: 'Ha! Famous last words. Good luck!' }] } },
        { label: 'Just looking around', end: "Take your time. This place is something else, isn't it?" },
      ],
    },
    {
      say: 'Excuse me, do you know where the pool party is?',
      replies: [
        { label: 'Down the hall, past the elevators', end: "Perfect, thank you! Maybe see you down there." },
        { label: 'No idea, sorry', next: { say: "No worries. I'll follow the music.", replies: [{ label: 'Have fun!', end: 'You too!' }] } },
      ],
    },
    {
      say: (c) => (c.drink ? "What are you drinking? That looks good." : "You look like you need a drink. The bar's amazing."),
      replies: [
        { label: 'Old fashioned', end: "Classic. I'm getting one of those." },
        { label: 'Champagne, obviously', end: "Ha! When in Vegas. Cheers!" },
        { label: 'Not drinking tonight', end: 'Respect. Somebody has to remember this night!' },
      ],
    },
    {
      say: 'Is this your first time in Vegas?',
      replies: [
        { label: 'First time!', next: { say: "Oh, you have to see the fountains from the terrace. And the suites upstairs. Wow.", replies: [{ label: 'Thanks for the tip', end: 'Enjoy it, seriously!' }] } },
        { label: 'Been here plenty', next: { say: "A regular! What's your game?", replies: [{ label: 'Craps', end: 'A dice man. Respect.' }, { label: 'Roulette', end: 'Red or black, the classic.' }, { label: 'Slots', end: 'Nothing wrong with that. Good luck!' }] } },
      ],
    },
    {
      say: 'Did you see that guy win on roulette earlier? Straight up, thirty five to one!',
      replies: [
        { label: 'That was me', next: { say: "No way! Drinks are on you, then!", replies: [{ label: 'Ha, maybe later', end: "I'm holding you to that!" }, { label: 'Sure, why not', end: "Now that's Vegas spirit!" }] } },
        { label: 'Missed it', end: 'Keep your eyes open, it happens all night.' },
      ],
    },
  ],
  pool: [
    {
      say: 'This pool party is insane, right?',
      replies: [
        { label: 'The DJ is great', end: "He's playing all night. Grab a lounger before they're gone!" },
        { label: "Isn't it late for a pool?", end: "It's Vegas! Late is when it gets good." },
      ],
    },
    {
      say: 'Want to get in the water? It is actually warm.',
      replies: [
        { label: "I didn't bring a suit", end: "Ha! There's a shop in the lobby. Think about it." },
        { label: 'Maybe later', end: "Your loss! It's perfect." },
      ],
    },
  ],
  bar: [
    {
      say: 'The bartender here is a legend. Ask for something off menu.',
      replies: [
        { label: 'What should I get?', end: "Tell her you want something smoky. Trust me." },
        { label: "I'll stick to beer", end: 'Ha! Fair enough. Cheers!' },
      ],
    },
  ],
  bartender: [
    {
      say: 'Evening! What can I get you?',
      replies: [
        { label: 'Surprise me', end: "Coming right up. You'll like this one." },
        { label: "What's popular?", next: { say: "The old fashioned with a twist, and our espresso martini. Both go fast.", replies: [{ label: 'Espresso martini', end: 'Good choice. One sec.' }, { label: 'Old fashioned', end: 'Classic. Coming up.' }] } },
        { label: 'Just looking', end: "No rush. I'm here all night." },
      ],
    },
  ],
  waiter: [
    {
      say: 'Champagne, sir? Compliments of the house.',
      replies: [
        { label: 'Yes, please', end: 'Enjoy your evening!' },
        { label: "I'm good, thanks", end: 'Of course. Let me know if you change your mind.' },
      ],
    },
  ],
  croupier: [
    {
      say: 'Good evening. Welcome to the table. Can I get you some chips?',
      replies: [
        { label: "What's the minimum?", end: 'Ten dollars, sir. Five hundred straight up.' },
        { label: 'Any tips?', end: "Between us, the house always has an edge. But tonight feels lucky." },
        { label: 'Just watching', end: 'Of course. Jump in whenever you like.' },
      ],
    },
  ],
  'dealer-roulette': [
    {
      say: 'Welcome! Place your bets whenever you are ready.',
      replies: [
        { label: "What's hitting tonight?", end: 'Red has been running hot. Seventeen came up twice.' },
        { label: 'Explain the table?', end: 'Inside bets pay more, outside bets hit more often. Ten dollar minimum.' },
      ],
    },
  ],
  'dealer-craps': [
    {
      say: 'Hey, new shooter! Want the dice?',
      replies: [
        { label: 'How do I start?', end: 'Put a chip on the Pass Line, then pick up the dice and throw them to the far wall.' },
        { label: "Let's go!", end: 'Alright! Pass line first, then hit the back wall.' },
        { label: 'Just watching', end: "No problem. It's a hot table, though." },
      ],
    },
  ],
};
