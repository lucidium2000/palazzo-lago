/**
 * The dealer's call: when to close the betting and go (the roulette spin; the
 * same idea as blackjack's deal). No button: the croupier watches the layout.
 *
 *  - Nobody has a bet down: he waits (no spin for an empty layout).
 *  - Bets are down and nobody has touched the layout for `idle` seconds: ready.
 *  - Or the betting has been open `window` seconds since the first bet: ready,
 *    even if someone is still fiddling (it can't wait forever).
 *  - Ready: he calls "No more bets" (`call`), and `warn` seconds later spins
 *    (`go`). Bets close at the call.
 *  - A player can say they're ready (`hurry`): he calls straight away.
 *
 * Pure (numbers and a signature string of everyone's layout), unit tested in
 * tests/dealerclock.test.ts. The host's table runs it in a shared room, so the
 * call and the spin happen once, for everyone.
 */

export interface DealerClockOptions {
  /** Quiet time after the last chip before he calls (s). */
  idle: number;
  /** Longest the betting stays open after the first bet (s). */
  window: number;
  /** From "No more bets" to the spin (s). */
  warn: number;
}

export const DEALER_CLOCK: DealerClockOptions = { idle: 4, window: 20, warn: 1.8 };
const EPS = 1e-6;

export interface DealerInput {
  /** Seconds (any steady clock). */
  now: number;
  /** Anyone has chips on the layout. */
  bets: boolean;
  /** Everyone's layout, as a string: any change is someone placing or lifting chips. */
  layout: string;
  /** Someone is holding chips over the table (on their way down): still betting. */
  placing?: boolean;
  /** The table is busy (spinning, paying out): betting isn't open. */
  busy?: boolean;
}

export type DealerEvent = 'call' | 'go' | null;

export class DealerClock {
  /** 'open': taking bets; 'calling': "No more bets" said, the spin is coming; 'done': spun, waiting for the table to open again. */
  state: 'open' | 'calling' | 'done' = 'open';
  private firstBet: number | null = null;
  private lastTouch = 0;
  private calledAt = 0;
  private layout = '';
  private hurried = false;

  constructor(readonly opts: DealerClockOptions = DEALER_CLOCK) {}

  /** A player said they're ready: call now (if there are bets). */
  hurry() {
    this.hurried = true;
  }

  /** Hold off: count the quiet time again from now (a bet the dealer can't take yet, say). */
  defer(now: number) {
    this.lastTouch = now;
    this.hurried = false;
  }

  /** Seconds until he calls (null: not counting: no bets, or already called). */
  untilCall(now: number): number | null {
    if (this.state !== 'open' || this.firstBet === null) return null;
    if (this.hurried) return 0;
    return Math.max(0, Math.min(this.lastTouch + this.opts.idle, this.firstBet + this.opts.window) - now);
  }

  update(s: DealerInput): DealerEvent {
    if (s.busy) {
      // Spinning / paying: the next round starts fresh when betting opens again.
      if (this.state !== 'calling') {
        this.state = 'done';
        this.firstBet = null;
        this.hurried = false;
      }
      this.layout = s.layout;
      return null;
    }
    if (this.state === 'done') this.state = 'open';
    if (this.state === 'calling') {
      if (s.now - this.calledAt >= this.opts.warn - EPS) {
        this.state = 'done';
        this.firstBet = null;
        this.hurried = false;
        return 'go';
      }
      return null;
    }
    // Open: watch the layout.
    if (s.layout !== this.layout || s.placing) {
      this.layout = s.layout;
      this.lastTouch = s.now;
    }
    if (!s.bets) {
      this.firstBet = null;
      this.hurried = false;
      return null;
    }
    if (this.firstBet === null) {
      this.firstBet = s.now;
      this.lastTouch = Math.max(this.lastTouch, s.now);
    }
    const quiet = s.now - this.lastTouch >= this.opts.idle - EPS;
    const long = s.now - this.firstBet >= this.opts.window - EPS;
    if (this.hurried || quiet || long) {
      this.state = 'calling';
      this.calledAt = s.now;
      return 'call';
    }
    return null;
  }

  /** The call came from elsewhere (the host, in a shared room): follow it. */
  called(now: number) {
    this.state = 'calling';
    this.calledAt = now;
  }

  /** Back to taking bets (a call that couldn't go ahead). */
  reopen(now: number) {
    this.state = 'open';
    this.lastTouch = now;
    this.hurried = false;
  }
}
