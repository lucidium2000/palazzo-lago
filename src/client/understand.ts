/**
 * Understanding what you say to someone (voice replies). Pure logic, no DOM.
 *
 * `understand(heard, replies)` reads what the recognizer heard and returns the
 * reply you meant (its index) or, when it isn't one of the replies, what you
 * were doing instead (an `Intent`: saying hello, thanks, goodbye, a compliment,
 * an insult, asking their name, the way somewhere, how they're doing, "cheers",
 * a laugh). `interpret` is the replies-only part.
 *
 * A reply is picked by, in order:
 *  1. saying its label (near enough: recognizer slips like "crabs" for "craps");
 *  2. its position ("the first one", "number two", "option B", "the last one");
 *  3. its words or any of its paraphrases (replylex.ts), with synonyms ("dice"
 *     is craps), fuzzy spelling (edit distance on longer words), sound-alike
 *     matching ("rule it" is roulette) and negation ("I don't want to play
 *     craps" never picks craps);
 *  4. yes / no ("hell yeah", "count me in", "I'll pass", "maybe later"...)
 *     picking the reply that agrees or declines.
 *
 * The browser recognizer gives a few alternatives joined by " | ": the first
 * one that means something wins.
 */

import { REPLY_LEX, SURPRISE, SYNONYMS } from './replylex';

export interface ReplyChoice {
  label: string;
  /** Agrees / accepts (set explicitly, or guessed from the label). */
  yes?: boolean;
  /** Declines (set explicitly, or guessed from the label). */
  no?: boolean;
}

/** What you said when it wasn't one of the replies. */
export type IntentKind = 'greet' | 'thanks' | 'bye' | 'compliment' | 'insult' | 'name' | 'where' | 'how' | 'cheers' | 'laugh';
export type Place = 'bar' | 'craps' | 'roulette' | 'blackjack' | 'poker' | 'slots' | 'pool' | 'bathroom' | 'elevator' | 'arcade' | 'food' | 'cashier' | 'terrace' | 'shop';
export interface Intent {
  kind: IntentKind;
  /** For 'where': the place asked about (undefined: couldn't tell). */
  place?: Place;
}

export type Understood = { reply: number } | { intent: Intent };

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NUMS: Record<string, string> = { '0': 'zero', '00': 'double zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten', '16': 'sixteen', '21': 'twenty one', '24': 'twenty four' };
const ORDS: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth' };

const CONTRACT: [RegExp, string][] = [
  [/\bwon'?t\b/g, 'will not'],
  [/\bcan'?t\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bain'?t\b/g, 'is not'],
  [/\bshan'?t\b/g, 'shall not'],
  [/\b(do|does|did|is|are|was|were|has|have|had|could|would|should|must|need)n'?t\b/g, '$1 not'],
  [/n't\b/g, ' not'],
  [/\bi'?m\b/g, 'i am'],
  [/\b(you|we|they)'?re\b/g, '$1 are'],
  [/\b(i|you|we|they|he|she|it|that|there)'ll\b/g, '$1 will'],
  [/\b(i|you|we|they)'?ve\b/g, '$1 have'],
  [/\b(i|you|we|they|he|she)'d\b/g, '$1 would'],
  [/\blet'?s\b/g, 'let us'],
  [/\b(it|that|what|where|who|how|there|here|he|she)'?s\b/g, '$1 is'],
  [/'s\b/g, ''],
  [/\bgonna\b/g, 'going to'],
  [/\bwanna\b/g, 'want to'],
  [/\bgotta\b/g, 'got to'],
  [/\bgimme\b/g, 'give me'],
  [/\blemme\b/g, 'let me'],
  [/\bdunno\b/g, 'do not know'],
  [/\bkinda\b/g, 'kind of'],
  [/\bsorta\b/g, 'sort of'],
  [/\boutta\b/g, 'out of'],
  [/\by'?all\b/g, 'you all'],
  [/\bsee ya\b/g, 'see you'],
  [/\bthank u\b/g, 'thank you'],
  [/\ball right\b/g, 'alright'],
  [/\bblack jack\b/g, 'blackjack'],
  [/\btwenty one\b/g, 'twentyone'],
  [/\bhold em\b/g, 'holdem'],
  [/\bo k\b/g, 'okay'],
];

/** Lower case, contractions spelled out, numbers as words, punctuation gone (commas kept as " , "). */
export function normalize(t: string): string {
  let s = ' ' + t.toLowerCase().replace(/[’‘`]/g, "'") + ' ';
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, (m, n: string) => ORDS[n] ?? m);
  s = s.replace(/\b\d+\b/g, (n) => NUMS[n] ?? n);
  for (const [re, r] of CONTRACT) s = s.replace(re, r);
  s = s.replace(/[,;.!?:]+/g, ' , ').replace(/[^a-z, ]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Rough stem so "drinks"/"drink", "playing"/"play" match. */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  let s = w.replace(/ies$/, 'y');
  const t = s.replace(/(ing|ed)$/, '');
  if (t !== s && t.length >= 3) s = t;
  if (/[^s]s$/.test(s) && s.length > 3) s = s.slice(0, -1);
  return s;
}

const CANON = new Map<string, string>();
for (const g of SYNONYMS) for (const w of g) CANON.set(stem(w), g[0]);
/** The word's meaning: its synonym group, or its stem. */
const canon = (w: string) => CANON.get(stem(w)) ?? CANON.get(w) ?? stem(w);

/** A sound-alike key: voiced and unvoiced consonants merged, vowels dropped ("craps" = "crabs", "roulette" = "rule it"). */
export function phonetic(w: string): string {
  let s = w
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/gh/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/b/g, 'p')
    .replace(/d/g, 't')
    .replace(/g/g, 'k')
    .replace(/v/g, 'f')
    .replace(/(.)\1+/g, '$1');
  if (!s) return s;
  const first = /[aeiouy]/.test(s[0]) ? 'a' : s[0];
  s = (first + s.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1');
  if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1);
  return s;
}

/** Damerau-Levenshtein distance (with adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[m][n];
}

/** Function words: they don't pick a reply on their own. */
const STOP = new Set(
  'the a an i am is are was were be been being it its to of and or you your yours me my mine we us our on in at out for this that these those what just some get got go do did does done how here there so very um uh er erm hmm oh ah well like would will can could should shall have has had with about from by then than let he she him her they them his their into too also any an'.split(' '),
);
/** Words a reply's meaning shouldn't hang on alone (said for politeness). */
const SOFT = new Set(['thanks', 'please', 'sorry', 'okay', 'yes', 'yeah', 'sure', 'ha', 'good', 'great', 'alright']);
/** Negating words (their scope runs to the next break). */
const NEGATORS = new Set(['not', 'never', 'without', 'hate', 'nor', 'neither']);
/** "No" before these isn't negating them ("no idea", "no way", "no problem"). */
const NO_EXEMPT = new Set(['idea', 'way', 'problem', 'problems', 'doubt', 'sorry', 'worries', 'worry', 'clue', 'chance', 'question', 'kidding', 'joke', 'rush', 'big', 'more', 'no', 'yes', 'yeah', 'nope', 'nah', 'i', 'you', 'it', 'he', 'she', 'we', 'they', 'not', 'sir', 'maam', 'man', 'dude', 'bro', 'mate', 'honey', 'darling']);
/** Words that end a negation's reach. */
const BREAKS = new Set([',', 'but', 'and', 'or', 'instead', 'rather', 'just', 'i', 'you', 'so', 'then', 'because', 'though', 'although', 'let']);

interface Tok {
  w: string;
  s: string;
  c: string;
  p: string;
  neg: boolean;
  content: boolean;
}

/** Words with their meaning, sound and whether a negation covers them. */
function tokens(text: string): Tok[] {
  const raw = normalize(text).split(' ').filter(Boolean);
  const out: Tok[] = [];
  let scope = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (w === ',' || BREAKS.has(w)) scope = 0;
    if (w === ',') {
      out.push({ w, s: w, c: w, p: '', neg: false, content: false });
      continue;
    }
    const content = !STOP.has(w) && !NEGATORS.has(w) && w.length >= 2 && w !== 'no';
    out.push({ w, s: stem(w), c: canon(w), p: phonetic(w), neg: scope > 0 && content, content });
    if (scope > 0) scope--;
    // "Absolutely not", "of course not", "better not": the "not" at the end turns down what came before.
    if (w === 'not' && (i + 1 === raw.length || raw[i + 1] === ',')) {
      const prev = out.length >= 2 ? out[out.length - 2] : null;
      if (prev?.content) prev.neg = true;
    }
    if (NEGATORS.has(w)) scope = 5;
    else if (w === 'no') {
      const nx = raw[i + 1];
      if (nx && nx !== ',' && !NO_EXEMPT.has(nx) && !STOP.has(nx)) scope = 2;
    }
  }
  return out;
}

const clean = (ts: Tok[]) => ts.filter((t) => t.w !== ',');

/** How alike two words are, 0..1: same meaning 1, sound-alike .85, a slip of a letter or two .75. */
function sim(a: Tok, b: { w: string; s: string; c: string; p: string }): number {
  if (a.w === b.w || a.s === b.s || a.c === b.c) return 1;
  const short = Math.min(a.w.length, b.w.length);
  if (short >= 5 && a.p.length >= 3 && a.p === b.p) return 0.85;
  if (short >= 5) {
    const d = editDistance(a.s, b.s);
    if (d <= 1 || (short >= 8 && d <= 2)) return 0.75;
  }
  return 0;
}

interface Heard {
  toks: Tok[];
  /** Adjacent words run together ("rule it" -> "ruleit", "black jack"). */
  pairs: { w: string; s: string; c: string; p: string; neg: boolean }[];
  text: string;
}

function hear(text: string): Heard {
  const toks = clean(tokens(text));
  const pairs = [];
  for (let i = 0; i + 1 < toks.length; i++) {
    const w = toks[i].w + toks[i + 1].w;
    pairs.push({ w, s: stem(w), c: canon(w), p: phonetic(w), neg: toks[i].neg || toks[i + 1].neg });
  }
  return { toks, pairs, text: toks.map((t) => t.w).join(' ') };
}

/** How well a phrase (a label or one of its paraphrases) matches what was heard. */
function phraseScore(phrase: Tok[], h: Heard): number {
  const ph = clean(phrase);
  if (!ph.length) return 0;
  // The whole phrase, in order, with the same sense (negated or not): a strong match.
  for (let i = 0; i + ph.length <= h.toks.length; i++) {
    let ok = true,
      low = 1;
    for (let j = 0; j < ph.length && ok; j++) {
      const a = ph[j],
        b = h.toks[i + j];
      if (a.content) {
        const v = sim(a, b);
        low = Math.min(low, v);
        ok = v >= 0.75 && a.neg === b.neg;
      } else ok = a.w === b.w || a.c === b.c;
    }
    // (A slip of the tongue counts a little less than the real thing.)
    if (ok) return (1 + 0.06 * ph.length) * (low < 1 ? 0.9 : 1);
  }
  // Otherwise, its meaningful words.
  const content = ph.filter((t) => t.content);
  if (!content.length) return 0;
  let sum = 0,
    matched = 0;
  for (const t of content) {
    let best = 0,
      neg = false;
    for (const x of h.toks) {
      if (!x.content) continue;
      const v = sim(t, x);
      if (v > best) {
        best = v;
        neg = x.neg;
      }
    }
    for (const x of h.pairs) {
      const v = sim(t, x) * 0.95;
      if (v > best) {
        best = v;
        neg = x.neg;
      }
    }
    if (best === 0) continue;
    matched++;
    if (neg !== t.neg) sum -= SOFT.has(t.c) ? 0 : best;
    else sum += SOFT.has(t.c) && content.length > 1 ? best * 0.5 : best;
  }
  // Turned down only counts when it's all of it ("not craps", not "...all the time" for "not my first time").
  if (sum < 0 && matched < content.length) return 0;
  return Math.min(1, sum / Math.min(3, content.length));
}

const phraseCache = new Map<string, Tok[][]>();
/** A reply's label and its paraphrases, as words. */
function phrasesOf(label: string): Tok[][] {
  let p = phraseCache.get(label);
  if (!p) {
    p = [label, ...(REPLY_LEX[label]?.also ?? [])].map(tokens);
    phraseCache.set(label, p);
  }
  return p;
}

/** How well what was heard matches a reply (its best phrase); negative if you said you didn't want it. */
function replyScore(label: string, h: Heard): number {
  let best = -Infinity,
    worst = Infinity;
  for (const p of phrasesOf(label)) {
    const v = phraseScore(p, h);
    best = Math.max(best, v);
    worst = Math.min(worst, v);
  }
  // Turned down by name ("I don't want to play craps") and not asked for any other way.
  return best < 0.5 && worst <= -0.5 ? worst : best;
}

// ---------------------------------------------------------------------------
// Yes and no
// ---------------------------------------------------------------------------

/** Not a no, whatever the words ("why not", "not bad", "no problem"). */
const YES_DESPITE = /\b(why not|not bad|can not complain|do not mind|would not mind|not a problem|no problem|no doubt|no question|can not wait|not a bad idea|i do not see why not|without a doubt|no worries)\b/;
/** Neither ("I don't know", "not sure"). */
const NEITHER = /\b(do not know|not sure|no idea|who knows|hard to say|depends)\b/;
const NO_PHRASE =
  /\b(no|nope|nah|naw|not really|not now|not today|not tonight|not right now|not for me|not interested|i am good|i am fine|i am alright|i am okay|i am all set|i am set|i am ok|all set|i will pass|i pass|hard pass|pass|no way|no thanks|no thank you|maybe later|maybe another time|maybe next time|some other time|another time|next time|rain check|i would rather not|rather not|do not think so|i guess not|i suppose not|probably not|not a chance|never|no chance|absolutely not|definitely not|of course not|certainly not|count me out|i am out|no can do|negative|nothing|not at all|not so much|not yet|i do not|i will not|i can not|skip|later|not exactly|not quite|not tonight thanks|i am alright thanks|i am good thanks)\b/;
const YES_PHRASE =
  /\b(yes|yeah|yea|yep|yup|yah|ya|sure|ok|okay|absolutely|definitely|certainly|of course|totally|aye|alright|right on|correct|indeed|gladly|love to|would love|i would|you bet|hell yeah|hell yes|heck yeah|heck yes|for sure|count me in|sounds good|sounds great|sounds fun|sounds like a plan|i am in|why not|let us do it|let us go|do it|go for it|go ahead|i am down|please|sign me up|deal|i guess|i suppose|maybe|probably|perhaps|might as well|sure thing|obviously|naturally|uh huh|mm hmm|mhm|yes sir|affirmative|i do|i will|cool|nice|great|perfect|awesome|fine|good|thanks|thank you|lovely|brilliant|excellent|you know it|bring it on|bring it|of course i do|i would like that|that would be great|why not)\b/;

/** What the heard text says, if anything: a yes, a no, or neither. */
export function yesNo(heard: string): 'yes' | 'no' | null {
  const t = clean(tokens(heard))
    .map((x) => x.w)
    .join(' ');
  if (!t) return null;
  if (YES_DESPITE.test(t)) return 'yes';
  if (NEITHER.test(t) && !/\b(yes|no)\b/.test(t)) return null;
  if (NO_PHRASE.test(t)) return 'no';
  if (YES_PHRASE.test(t)) return 'yes';
  if (/\bnot\b/.test(t)) return 'no';
  return null;
}

/** Does this label read as agreeing or declining? */
export function stance(label: string): 'yes' | 'no' | null {
  const s = REPLY_LEX[label]?.stance;
  if (s) return s === 'none' ? null : s;
  const l = label.toLowerCase();
  if (/^(no\b|nope|nah|not\b|i'?m good|i'?m fine|i'?m alright|maybe later|just (looking|watching)|no thanks|i'?ll (stick|pass)|missed it|isn't it late|sorry, no|better not|never\b)/.test(l)) return 'no';
  if (/^(yes|yeah|sure|absolutely|first time|best night|that was me|sure, why not|let'?s go|ok|i'?m in|i'?d love|totally|always)/.test(l)) return 'yes';
  return null;
}

const stanceOf = (r: ReplyChoice): 'yes' | 'no' | null => (r.yes ? 'yes' : r.no ? 'no' : stance(r.label));
const neutral = (r: ReplyChoice) => REPLY_LEX[r.label]?.stance === 'none';

// ---------------------------------------------------------------------------
// Positions: "the first one", "number two", "option B", "the last one"
// ---------------------------------------------------------------------------

const ORDINALS: [RegExp, (n: number) => number | null][] = [
  [/\b(first|top|number one|option one|choice one|answer one|reply one|option a|choice a|answer a|letter a|button a|option eh|plan a|a button|one)\b/, () => 0],
  [/\b(second|number two|option two|choice two|answer two|reply two|option b|choice b|answer b|letter b|button b|option bee|option be|plan b|b button|number to|option to|two)\b/, () => 1],
  [/\b(third|number three|option three|choice three|answer three|reply three|option c|choice c|answer c|letter c|button c|option see|option sea|option x|button x|x button|letter x|number free|three)\b/, () => 2],
  [/\b(last|bottom|final|lowest)\b/, (n) => n - 1],
  [/\b(middle|centre|center)\b/, (n) => (n === 3 ? 1 : null)],
];
const FILLER = new Set(
  'the one ones option choice answer reply number letter button i will would like take pick choose go with want say let us me give please um uh er ok okay yeah yes yep sure that this is it a an for think guess hmm oh so then well do am going to select sounds good great fine alright how about maybe just hey there thanks thank you plan get have i have one'.split(' '),
);

/** A reply picked by its position, when that's all you said. */
export function ordinal(heard: string, n: number): number | null {
  const t = hear(heard).text;
  if (!t || /\bother\b/.test(t)) return null;
  for (const [re, at] of ORDINALS) {
    const m = t.match(re);
    if (!m) continue;
    const rest = t.replace(re, ' ').split(' ').filter((w) => w && !FILLER.has(w));
    if (rest.length) continue;
    // A bare "one"/"two" only counts with nothing else said ("one" alone, "number one" is fine).
    const i = at(n);
    return i !== null && i >= 0 && i < n ? i : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Picking a reply
// ---------------------------------------------------------------------------

/** The heard text is (nearly) the label itself. */
function verbatim(h: Heard, label: string): boolean {
  const l = clean(tokens(label))
    .map((t) => t.w)
    .join(' ');
  if (!l || !h.text) return false;
  if (l === h.text) return true;
  if (l.length < 6) return false;
  return editDistance(l, h.text) <= Math.floor(l.length * 0.18);
}

function pickReply(h: Heard, raw: string, replies: ReplyChoice[], skipEarly = false): number | null {
  if (!h.toks.length || !replies.length) return null;
  if (/^(the )?other( one)?$/.test(h.text)) return null;
  if (!skipEarly) {
    const v = replies.findIndex((r) => verbatim(h, r.label));
    if (v >= 0) return v;
    const o = ordinal(raw, replies.length);
    if (o !== null) return o;
  }
  const scores = replies.map((r) => replyScore(r.label, h));
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const [best, bi] = order[0];
  const second = order[1]?.[0] ?? -Infinity;
  const yn = yesNo(raw);
  const fits = (r: ReplyChoice, i: number, want: 'yes' | 'no') => stanceOf(r) === want && scores[i] > -0.5;
  // A clear match on words or a paraphrase.
  if (best >= 0.5 && best - second >= 0.05) return bi;
  if (best >= 0.5) {
    // A tie: yes/no decides between the tied ones.
    const tied = order.filter(([s]) => best - s < 0.05).map(([, i]) => i);
    if (yn) {
      const t = tied.filter((i) => fits(replies[i], i, yn));
      if (t.length === 1) return t[0];
    }
    return null;
  }
  // Yes / no.
  if (yn) {
    const i = replies.findIndex((r, k) => fits(r, k, yn));
    if (i >= 0) return i;
    // Two replies and you said the opposite of one of them: the other (unless it's no answer to a yes/no).
    if (replies.length === 2) {
      const other = replies.findIndex((r, k) => fits(r, k, yn === 'yes' ? 'no' : 'yes'));
      if (other >= 0 && !neutral(replies[1 - other]) && scores[1 - other] > -0.5) return 1 - other;
    }
  }
  // Two replies and you turned one down by name: the other.
  if (replies.length === 2) {
    const neg = scores.findIndex((s) => s <= -0.5);
    if (neg >= 0 && scores[1 - neg] >= 0) return 1 - neg;
  }
  // A weaker but unambiguous match on words.
  if (best >= 0.3 && best - second >= 0.15) return bi;
  return null;
}

const alternatives = (heard: string) =>
  heard
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

/** The reply you meant (its index), or null. */
export function interpret(heard: string, replies: ReplyChoice[]): number | null {
  for (const alt of alternatives(heard)) {
    const i = pickReply(hear(alt), alt, replies);
    if (i !== null) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Everything else you might say
// ---------------------------------------------------------------------------

const PLACES: [Place, RegExp][] = [
  ['bathroom', /\b(bathrooms?|restrooms?|toilets?|loo|washrooms?|mens room|men room|ladies room|little boys room|little girls room|powder room|gents|the ladies|wc|lavatory|pee|potty|facilities)\b/],
  ['craps', /\b(craps?|dice|crap table|craps table|crabs)\b/],
  ['roulette', /\b(roulette|the wheel|roulette wheel|rule it)\b/],
  ['blackjack', /\b(blackjack|twentyone|card tables?)\b/],
  ['poker', /\b(poker|poker room|holdem|card room)\b/],
  ['slots', /\b(slots?|slot machines?|pigs?|piggy|machines|pokies)\b/],
  ['pool', /\b(pool|pool party|swim|swimming|pool deck|the deck|hot tub|jacuzzi)\b/],
  ['elevator', /\b(elevators?|lifts?|hotel|my room|the rooms|rooms|suite|upstairs|lobby|front desk|reception|check in)\b/],
  ['arcade', /\b(arcade|video games|games room|game room|arcade games)\b/],
  ['food', /\b(food|eat|something to eat|restaurants?|food court|pizza|burgers?|noodles|gelato|ice cream|snacks?|dinner|lunch|breakfast|buffet|hungry|grub|bite to eat|promenade)\b/],
  ['cashier', /\b(cashier|cage|cash out|cash in|change|atm|money|cash)\b/],
  ['terrace', /\b(terrace|fountains?|balcony|outside|the view|fresh air|patio)\b/],
  ['shop', /\b(shop|store|boutique|gift shop|souvenirs?|lago luxe|shopping)\b/],
  ['bar', /\b(bar|bar lago|lounge|bartender|drinks?|cocktails?|beer|booze)\b/],
];

export function placeIn(text: string): Place | undefined {
  const t = hear(text).text;
  return PLACES.find(([, re]) => re.test(t))?.[0];
}

const ASK_WHERE = /(^((so|and|um|uh|hey|excuse me|sorry|okay|ok|say) )*where\b|\b(you know where|tell me where|show me where|where (is|are|can|do|does|did|would|should|could|might|will)\b)|\b(which way|how do i get|how can i get|how to get|how would i get|directions|looking for|trying to find|need to find|can not find|find the|show me|take me|point me|is there an?|way to|know where|lead me|get to the|head to the)\b)/;
const NEEDS_PLACE = /\b(i am hungry|i am starving|i need to pee|i have to pee|i need the (bathroom|restroom|toilet)|nature calls|i need to go to the (bathroom|restroom|toilet)|i want to swim|i want to eat|i need cash|i need money)\b/;

const INSULT =
  /\b(shut up|shut it|shut your mouth|get lost|go away|piss off|pissoff|buzz off|bugger off|sod off|back off|beat it|scram|get out of my face|get away from me|leave me alone|screw you|fuck you|fuck off|f off|go to hell|bite me|get a life|nobody asked|who asked you|nobody cares|nobody likes you|idiot|moron|dumbass|imbecile|you suck|you stink|you smell|you are (so |really |such |a |an |kind of |pretty |very )*(annoying|an idiot|stupid|ugly|boring|a loser|loser|a jerk|jerk|weird|creepy|dumb|a moron|a clown|clown|rude|pathetic|a joke|a fool|fool|fat|terrible|awful|ridiculous|lame|tacky|a pest|pest|a nuisance|a bore|useless|the worst|obnoxious|irritating|full of it|a liar|old)|you look (so |really |pretty |kind of )*(ugly|stupid|ridiculous|terrible|awful|like a clown|dumb|old|tacky|cheap|silly)|what is your problem|you talk too much|zip it|knock it off|stop talking|be quiet|go bother someone else|stop bothering me|leave me be|you are annoying me|so annoying|really annoying)\b/;
const BYE =
  /\b(bye|goodbye|good bye|bye bye|byebye|see you(?! (there|at|in|by|on))|see you later|see you around|catch you later|^later (man|dude|bro|guys|pal|mate)|got to go|have to go|need to go|i must go|must be going|i should go|i should get going|i am off|i am leaving|i will leave|i am heading out|heading out|take care|farewell|nice (talking|chatting|meeting) (to |with )?you|have a good (one|night|evening)|enjoy your (night|evening)|peace out|cheerio|ciao|adios|so long|got to run|have to run|got to bounce|i am out of here|until next time|talk to you later|talk later|i will let you go|leave you to it|gotta go)\b/;
const CHEERS = /\b(cheers|salud|salute|skol|prost|bottoms up|chin chin|to your health|here is to (you|us|vegas|tonight|that|the night)|a toast|let us toast|toast to|kanpai|sante|slainte|clink)\b/;
const NAME = /\b(what is your name|whats your name|your name|who are you|what do (they|people|i) call you|what should i call you|what can i call you|introduce yourself|and you are|who am i talking to|do i know you|what are you called|name)\b/;
const HOW =
  /\b(how are you|how are ya|how you doing|how are you doing|how is your (night|evening|day|luck)( going)?|how are things|how have you been|are you winning|you winning|are you up|how much are you up|are you having (fun|a good (time|night))|you having (fun|a good (time|night))|how about you|what about you|and you|how is the night treating you|how is vegas treating you|how is your luck|any luck|are you okay|you okay|how do you feel|how are you feeling|are you enjoying|you doing okay|are you doing okay|how is your night|how is it going for you|how are you finding it)\b/;
const GREET =
  /\b(hi|hey|hello|howdy|hiya|heya|yo|sup|what is up|wassup|whats up|what up|good evening|good morning|good afternoon|good day|evening|morning|hey there|hi there|hello there|greetings|hola|bonjour|aloha|nice to meet you|pleased to meet you|good to see you|great to see you|long time no see|how is it going|how is everything|how goes it|what is new|what is happening|g day|ahoy)\b/;
const GREET_ONLY = /^((hi|hey|hello|howdy|hiya|heya|yo|sup|what is up|wassup|whats up|what up|good evening|hey there|hi there|hello there|how is it going|how goes it|hey hey|oh|well|so)( there| man| buddy| pal| friend| everyone)? ?)+$/;
const THANKS = /\b(thanks|thank you|thankyou|thx|appreciate (it|that|you)|much appreciated|grazie|merci|gracias|much obliged|i owe you|you are the best|that is kind|so kind)\b/;
const COMPLIMENT =
  /\b((nice|great|cool|sharp|love the|love your|i like your|i like the|beautiful|lovely|fancy|snazzy|classy|awesome|amazing|fabulous|gorgeous) (suit|jacket|dress|hat|outfit|shirt|shoes|tie|look|style|watch|hair|sash|veil|pearls|boots|necklace|earrings|glasses|smile|accent|voice|tux|tuxedo|bow tie|vest|uniform|threads|getup)|you look (so |really |very |pretty )*(great|good|nice|sharp|amazing|fantastic|beautiful|lovely|gorgeous|stunning|fabulous|classy|elegant|dapper|handsome|pretty|cool|fancy|wonderful|lucky)|looking (good|great|sharp|fine|fancy|dapper)|you are (so |really |very |pretty )*(funny|cool|great|awesome|nice|sweet|lovely|hilarious|the best|a legend|beautiful|gorgeous|charming|kind|amazing|fun|smart|stylish|classy|elegant|a star|a delight|a gem)|great (outfit|suit|style)|you have (great|good) taste|what a (nice|great|lovely|sharp|fancy) (suit|dress|hat|outfit|jacket)|i love your|love the (hat|suit|dress|outfit|look|sash|boots|pearls)|you clean up nice|dapper|gorgeous)\b/;
const LAUGH = /(^|\s)(ha( ha)+|ha|haha+|hah|ah ha|ahaha+|hahaha+|lol|lmao|rofl|hehe+|heh|he he( he)*|that is (so |really )?(funny|hilarious)|hilarious|very funny|so funny|good one|you crack me up|laughs?|laughing)(\s|$)/;

/** What you were doing, if it wasn't answering. `strong`: only the ones that beat a reply's words. */
export function intentOf(heard: string, strong = false): Intent | null {
  const t = hear(heard).text;
  if (!t) return null;
  if (INSULT.test(t)) return { kind: 'insult' };
  if (BYE.test(t) || /^(good ?night)( (all|everyone|then|now|friend|my friend|folks))?$/.test(t)) return { kind: 'bye' };
  if (NAME.test(t) && !/\bname (is|of)\b/.test(t)) return { kind: 'name' };
  if (ASK_WHERE.test(t) || NEEDS_PLACE.test(t)) {
    const place = placeIn(t);
    if (place || /^where\b|\bwhere (is|are|am)\b/.test(t)) return { kind: 'where', place };
  }
  if (HOW.test(t)) return { kind: 'how' };
  if (CHEERS.test(t)) return { kind: 'cheers' };
  // Nothing but a hello ("hey, what's up?"): a greeting, whatever the replies' words.
  if (GREET_ONLY.test(t) && !/^((oh|well|so) ?)+$/.test(t)) return { kind: 'greet' };
  if (strong) return null;
  if (yesNo(t) === 'no' && !THANKS.test(t)) return null;
  if (COMPLIMENT.test(t)) return { kind: 'compliment' };
  if (LAUGH.test(t)) return { kind: 'laugh' };
  if (THANKS.test(t)) return { kind: 'thanks' };
  if (GREET.test(t)) return { kind: 'greet' };
  return null;
}

/**
 * Everything at once: the reply you meant, or what you were doing instead, or
 * null (they didn't catch it). Order: the label itself, its position, an
 * insult / goodbye / question to them / cheers, the reply's words and yes/no,
 * then a greeting, thanks, compliment or laugh.
 */
export function understand(heard: string, replies: ReplyChoice[]): Understood | null {
  for (const alt of alternatives(heard)) {
    const h = hear(alt);
    if (!h.toks.length) continue;
    const v = replies.findIndex((r) => verbatim(h, r.label));
    if (v >= 0) return { reply: v };
    const o = ordinal(alt, replies.length);
    if (o !== null) return { reply: o };
    const strong = intentOf(alt, true);
    if (strong) return { intent: strong };
    const i = pickReply(h, alt, replies, true);
    if (i !== null) return { reply: i };
    const weak = intentOf(alt);
    if (weak) return { intent: weak };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Menus: a drink at the bar, a dish at a counter
// ---------------------------------------------------------------------------

/**
 * The menu item you asked for (its index), 'surprise' for "surprise me" and
 * the like, or null. `aliases`: other names, by item name (replylex.ts).
 */
export function matchMenu(heard: string, names: string[], aliases: Record<string, string[]> = {}, surprise = SURPRISE): number | 'surprise' | null {
  for (const alt of alternatives(heard)) {
    const h = hear(alt);
    if (!h.toks.length) continue;
    const scores = names.map((n) => {
      let best = -Infinity;
      for (const p of [n, ...(aliases[n] ?? [])]) best = Math.max(best, phraseScore(tokens(p), h));
      return best;
    });
    const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    const [best, bi] = order[0] ?? [0, -1];
    const second = order[1]?.[0] ?? -Infinity;
    if (best >= 0.5 && best - second >= 0.05) return bi;
    if (best >= 0.5) continue; // two things at once: say it again
    if (surprise.some((p) => phraseScore(tokens(p), h) >= 1)) return 'surprise';
  }
  return null;
}

// ---------------------------------------------------------------------------
// What to listen for (a small offline recognizer does far better with a list)
// ---------------------------------------------------------------------------

const YES_WORDS = 'yes yeah yep yup sure okay ok absolutely definitely certainly please totally course alright right correct indeed gladly love maybe probably perhaps guess suppose bet hell heck count in sounds good great fine cool nice perfect awesome why not lets let us do it go ahead down sign me up deal'.split(' ');
const NO_WORDS = 'no nope nah not never thanks thank you pass later nothing good fine alright set rather think so way chance tonight now today really interested skip hard maybe another time next'.split(' ');
const ORD_WORDS = 'first second third last top bottom middle one two three number option choice a b c x the'.split(' ');
const INTENT_WORDS =
  'hi hey hello howdy evening morning up whats what is going how are you doing thanks thank appreciate it bye goodbye see later go gotta got to take care night cheers salud salute bottoms toast your name who where which way find bathroom restroom toilet elevator lift pool bar craps roulette blackjack poker slots arcade food eat hungry pizza cashier terrace shop winning fun nice suit jacket dress hat look looking great sharp funny shut get lost away annoying idiot leave me alone haha ha lol'.split(
    ' ',
  );

const vocabWords = (t: string) => normalize(t).split(' ').filter((w) => w.length > 0 && w !== ',');

/** Words worth listening for while these replies are up: theirs and their paraphrases, yes/no, positions and small talk. */
export function vocabulary(replies: ReplyChoice[]): string[] {
  const set = new Set<string>([...YES_WORDS, ...NO_WORDS, ...ORD_WORDS, ...INTENT_WORDS, 'no thanks', 'not really', 'i am good', 'why not', 'of course', 'the first one', 'the second one', 'the last one']);
  for (const r of replies) for (const p of [r.label, ...(REPLY_LEX[r.label]?.also ?? [])]) for (const w of vocabWords(p)) set.add(w);
  return [...set];
}

/** Words worth listening for at a menu (a drink at the bar, a dish at a counter). */
export function menuVocabulary(names: string[], aliases: Record<string, string[]> = {}, surprise = SURPRISE): string[] {
  const set = new Set<string>(['can', 'i', 'get', 'have', 'a', 'an', 'the', 'one', 'please', 'some', 'like', 'want', 'would', 'give', 'me', 'no', 'thanks', 'nothing', 'not', 'yes', 'and']);
  for (const n of names) for (const p of [n, ...(aliases[n] ?? [])]) for (const w of vocabWords(p)) set.add(w);
  for (const p of surprise) for (const w of vocabWords(p)) set.add(w);
  return [...set];
}
