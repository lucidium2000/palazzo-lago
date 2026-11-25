/**
 * Understanding what you say back to someone (voice replies). Pure logic:
 * given what the recognizer heard and the reply choices on offer, pick the
 * reply you meant, or null if it's not clear. "Yes"-ish and "no"-ish answers
 * pick the reply that agrees or declines; otherwise words from a reply's label
 * ("craps", "espresso martini") pick that reply.
 */

export interface ReplyChoice {
  label: string;
  /** Agrees / accepts (set explicitly, or guessed from the label). */
  yes?: boolean;
  /** Declines (set explicitly, or guessed from the label). */
  no?: boolean;
}

const YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'absolutely', 'definitely', 'certainly', 'please', 'totally', 'course', 'aye', 'alright', 'right', 'correct', 'indeed', 'gladly', 'love'];
const NO = ['no', 'nope', 'nah', 'not', "don't", 'dont', 'never', 'thanks', 'pass', 'later', 'nothing', 'good'];
const STOP = new Set(['the', 'a', 'an', 'i', "i'm", 'im', 'is', 'it', 'its', "it's", 'to', 'of', 'and', 'or', 'you', 'me', 'my', 'on', 'in', 'at', 'for', 'be', 'this', 'that', 'what', "what's", 'whats', 'just', 'some', 'get', 'go', 'lets', "let's", 'how', 'do', 'here']);

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Rough stem so "drinks"/"drink", "playing"/"play" match. */
const stem = (w: string) => w.replace(/'s$/, '').replace(/(ing|ed|es|s)$/, '');

/** Does this label read as agreeing or declining? */
export function stance(label: string): 'yes' | 'no' | null {
  const l = label.toLowerCase();
  if (/^(no\b|nope|nah|not\b|i'?m good|i'?m fine|maybe later|just (looking|watching)|no thanks|i'?ll stick|missed it|isn't it late)/.test(l)) return 'no';
  if (/^(yes|yeah|sure|absolutely|first time|best night|that was me|sure, why not|let'?s go|ok)/.test(l)) return 'yes';
  return null;
}

/** What the heard text says, if anything: a yes, a no, or neither. */
export function yesNo(heard: string): 'yes' | 'no' | null {
  const w = words(heard);
  if (!w.length) return null;
  // "No thanks", "not really", "I'm good" decline even though they contain yes-ish words.
  const t = w.join(' ');
  if (/\b(no|nope|nah)\b/.test(t) || /\bnot (really|now|today|tonight)\b/.test(t) || /\bi'?m good\b/.test(t) || /\bno thank/.test(t)) return 'no';
  if (w.some((x) => YES.includes(x)) || /\buh huh\b|\bmm hmm\b|\bwhy not\b|\bof course\b/.test(t)) return 'yes';
  if (w.some((x) => NO.includes(x))) return 'no';
  return null;
}

/** The reply you meant (its index), or null. */
export function interpret(heard: string, replies: ReplyChoice[]): number | null {
  const hw = words(heard);
  if (!hw.length || !replies.length) return null;
  const hs = new Set(hw.map(stem));
  // 1. Words from a reply's label.
  let best = -1,
    bestScore = 0;
  replies.forEach((r, i) => {
    const lw = words(r.label).filter((w) => !STOP.has(w) && w.length > 2);
    const score = lw.filter((w) => hs.has(stem(w))).length / Math.max(1, Math.min(3, lw.length));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  // A clear keyword match wins (unless it's only a yes/no word).
  if (best >= 0 && bestScore >= 0.5) return best;
  // 2. Yes / no.
  const yn = yesNo(heard);
  if (yn) {
    const i = replies.findIndex((r) => (yn === 'yes' ? r.yes ?? stance(r.label) === 'yes' : r.no ?? stance(r.label) === 'no'));
    if (i >= 0) return i;
    // Only one reply agrees or declines and they said the other: pick the remaining one if there are two.
    if (replies.length === 2) {
      const other = replies.findIndex((r) => (yn === 'yes' ? r.no ?? stance(r.label) === 'no' : r.yes ?? stance(r.label) === 'yes'));
      if (other >= 0) return 1 - other;
    }
  }
  return best >= 0 && bestScore > 0 ? best : null;
}

/** Words worth listening for (helps a small offline recognizer): yes/no words and the replies' words. */
export function vocabulary(replies: ReplyChoice[]): string[] {
  const set = new Set<string>([...YES, ...NO, 'no thanks', 'not really', "i'm good", 'why not', 'of course']);
  for (const r of replies) for (const w of words(r.label)) if (w.length > 1) set.add(w.replace(/'/g, ''));
  return [...set];
}
