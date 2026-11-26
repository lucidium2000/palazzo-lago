/**
 * High-score tables: the top ten per game, three-letter initials. The host
 * keeps the room's tables (friends send theirs in, the host sends the table
 * back); playing alone, they're kept on this device.
 */

export interface ScoreEntry {
  n: string;
  s: number;
}

export const TABLE_SIZE = 10;
export const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .!';

/** The house's starting scores, so a fresh table has something to beat. */
const HOUSE = ['LGO', 'ACE', 'VIP', 'DOC', 'MAX', 'JET', 'ROX', 'KAT', 'ZED', 'BOB'];

export function defaultTable(top: number): ScoreEntry[] {
  return HOUSE.map((n, i) => ({ n, s: Math.max(1, Math.round((top * (TABLE_SIZE - i)) / TABLE_SIZE / 10) * 10) }));
}

/** Cleans initials from anywhere (a friend's message): three characters from the allowed set. */
export function cleanInitials(n: unknown): string {
  const s = String(n ?? '')
    .toUpperCase()
    .slice(0, 3);
  let out = '';
  for (const ch of s) out += INITIALS.includes(ch) ? ch : ' ';
  return out.padEnd(3, ' ');
}

/** Does this score make the table? */
export function qualifies(table: readonly ScoreEntry[], score: number): boolean {
  if (!(score > 0)) return false;
  if (table.length < TABLE_SIZE) return true;
  return score > table[table.length - 1].s;
}

/** Where the score would land (0-based), or -1. Ties go below existing entries. */
export function rankOf(table: readonly ScoreEntry[], score: number): number {
  if (!qualifies(table, score)) return -1;
  let i = 0;
  while (i < table.length && table[i].s >= score) i++;
  return i < TABLE_SIZE ? i : -1;
}

/** Inserts a score (returns its place, or -1 if it didn't make it). Keeps the table sorted and capped. */
export function insertScore(table: ScoreEntry[], n: string, s: number): number {
  const i = rankOf(table, s);
  if (i < 0) return -1;
  table.splice(i, 0, { n: cleanInitials(n), s: Math.floor(s) });
  if (table.length > TABLE_SIZE) table.length = TABLE_SIZE;
  return i;
}

/** Compact wire form: ['AAA', 123, 'BBB', 99, …]. */
export function packTable(t: readonly ScoreEntry[]): (string | number)[] {
  const out: (string | number)[] = [];
  for (const e of t) out.push(e.n, e.s);
  return out;
}

export function unpackTable(a: unknown): ScoreEntry[] | null {
  if (!Array.isArray(a)) return null;
  const t: ScoreEntry[] = [];
  for (let i = 0; i + 1 < a.length && t.length < TABLE_SIZE; i += 2) {
    const s = Number(a[i + 1]);
    if (!Number.isFinite(s) || s < 0) return null;
    t.push({ n: cleanInitials(a[i]), s: Math.floor(s) });
  }
  t.sort((x, y) => y.s - x.s);
  return t;
}

/**
 * Initials entry with the joystick: up/down changes the letter, right or a
 * button moves on, left goes back; after the third letter it's done.
 */
export class InitialsEntry {
  letters = [0, 0, 0];
  pos = 0;
  done = false;

  constructor(start = 'AAA') {
    for (let i = 0; i < 3; i++) this.letters[i] = Math.max(0, INITIALS.indexOf(start[i] ?? 'A'));
  }

  get text() {
    return this.letters.map((l) => INITIALS[l]).join('');
  }

  /** Feed one step of input: stick edges and a confirm press. */
  input(dx: number, dy: number, confirm: boolean, back: boolean) {
    if (this.done) return;
    const n = INITIALS.length;
    // Stick up steps forward through the alphabet (A, B, C…), down steps back.
    if (dy > 0) this.letters[this.pos] = (this.letters[this.pos] + 1) % n;
    if (dy < 0) this.letters[this.pos] = (this.letters[this.pos] + n - 1) % n;
    if (dx < 0 || back) this.pos = Math.max(0, this.pos - 1);
    if (dx > 0 || confirm) {
      if (this.pos === 2) this.done = true;
      else {
        this.pos++;
        // The next letter starts where the last one was (fast for "AAA", "MMM").
        this.letters[this.pos] = this.letters[this.pos - 1];
      }
    }
  }
}

/** Tables per game, persisted on this device. */
export class ScoreBook {
  private tables = new Map<string, ScoreEntry[]>();

  constructor(
    private key = 'palazzo-lago.arcade.v1',
    private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
  ) {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const o = JSON.parse(raw) as Record<string, unknown>;
        for (const [g, t] of Object.entries(o)) {
          const tab = unpackTable(t);
          if (tab) this.tables.set(g, tab);
        }
      }
    } catch {
      /* private mode or a bad save: start fresh */
    }
  }

  table(game: string, top = 10000): ScoreEntry[] {
    let t = this.tables.get(game);
    if (!t) this.tables.set(game, (t = defaultTable(top)));
    return t;
  }

  /** Replace a game's table (the host's copy arrived). */
  set(game: string, t: ScoreEntry[]) {
    this.tables.set(game, t);
    this.save();
  }

  add(game: string, n: string, s: number, top?: number): number {
    const i = insertScore(this.table(game, top), n, s);
    if (i >= 0) this.save();
    return i;
  }

  games(): string[] {
    return [...this.tables.keys()];
  }

  save() {
    try {
      const o: Record<string, unknown> = {};
      for (const [g, t] of this.tables) o[g] = packTable(t);
      this.storage?.setItem(this.key, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  }
}
