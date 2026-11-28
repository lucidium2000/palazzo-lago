/**
 * Wire format for things that happen to the casino's people (guests, staff)
 * that every player in the room should see and hear: the line someone says
 * back when you push, punch, douse or hit them, the lines they say to you in a
 * conversation, and the replies you say back.
 *
 * People are simulated on each machine, so the same guest can be somewhere
 * else on your friend's screen. A line names the person (`uid`, their role)
 * and where they were on the sender's machine; the receiver plays it from
 * that person if they're near that spot there, else from the nearest person
 * of that role close by, else from the spot itself.
 *
 * Everything is validated on the way in: nothing from the network reaches the
 * scene unless it's a known kind, a sane position and a short line.
 */

export const NPC_LINE_KINDS = ['pushed', 'punched', 'doused', 'hit', 'gasp', 'line', 'reply', 'security', 'slapped'] as const;
export type NpcLineKind = (typeof NPC_LINE_KINDS)[number];

export const NPC_ROLES = ['wander', 'slots', 'watch', 'croupier', 'bartender', 'patron', 'pianist', 'waiter', 'buddy', 'chat', 'pair'] as const;

/** A line said in the world, as the sender's game played it. */
export interface NpcLine {
  kind: NpcLineKind;
  /** The person's number (Person.uid), -1 for none (your crew, or you yourself for a reply). */
  uid: number;
  role: string;
  /** Where they stood on the sender's machine (feet). */
  pos: [number, number, number];
  /** What they said (empty for a gasp). */
  text: string;
  /** The recorded voice it was said in, and the stand-in voice. */
  voice: string;
  alt?: string;
  /** Caption name. */
  who: string;
  volume: number;
}

const MAX_TEXT = 240;
const VOICE = /^[A-Za-z0-9_.-]{1,48}$/;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function encodeNpcLine(l: NpcLine): Record<string, unknown> {
  const o: Record<string, unknown> = {
    k: NPC_LINE_KINDS.indexOf(l.kind),
    u: l.uid,
    r: NPC_ROLES.indexOf(l.role as (typeof NPC_ROLES)[number]),
    p: l.pos.map(r2),
    t: l.text.slice(0, MAX_TEXT),
    v: l.voice,
    w: l.who.slice(0, 24),
    vo: r2(l.volume),
  };
  if (l.alt) o.a = l.alt;
  return o;
}

export function decodeNpcLine(d: unknown): NpcLine | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const k = o.k;
  if (!Number.isInteger(k) || (k as number) < 0 || (k as number) >= NPC_LINE_KINDS.length) return null;
  const kind = NPC_LINE_KINDS[k as number];
  const uid = Number.isInteger(o.u) && (o.u as number) >= -1 && (o.u as number) < 100000 ? (o.u as number) : -1;
  const ri = o.r;
  const role = Number.isInteger(ri) && (ri as number) >= 0 && (ri as number) < NPC_ROLES.length ? NPC_ROLES[ri as number] : 'wander';
  const p = o.p;
  if (!Array.isArray(p) || p.length !== 3 || !p.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 5000)) return null;
  const text = typeof o.t === 'string' ? o.t.slice(0, MAX_TEXT) : '';
  if (!text && kind !== 'gasp') return null;
  const voice = typeof o.v === 'string' && VOICE.test(o.v) ? o.v : '';
  if (!voice && kind !== 'gasp') return null;
  const alt = typeof o.a === 'string' && VOICE.test(o.a) ? o.a : undefined;
  const who = typeof o.w === 'string' ? o.w.slice(0, 24) : '';
  const vo = typeof o.vo === 'number' && Number.isFinite(o.vo) ? Math.min(2, Math.max(0, o.vo)) : 1;
  return { kind, uid, role, pos: [p[0], p[1], p[2]], text, voice, alt, who, volume: vo };
}

/** The bits of a person the lookup needs. */
export interface NpcLike {
  uid: number;
  role: string;
  driven: boolean;
  pos: { x: number; y: number; z: number };
}

const flat = (a: NpcLike['pos'], b: readonly number[]) => Math.hypot(a.x - b[0], a.z - b[2]);

/**
 * The person on this machine a line belongs to: the same uid and role if
 * they're within `sameR` of where the sender had them, else the nearest
 * person of that role within `nearR`, else null (play it at the spot).
 * Friends' avatars and anyone's crew never match.
 */
export function resolveNpc<T extends NpcLike>(people: readonly T[], l: Pick<NpcLine, 'uid' | 'role' | 'pos'>, sameR = 3, nearR = 1.6): T | null {
  if (l.role === 'buddy') return null;
  if (l.uid >= 0) {
    const p = people.find((x) => x.uid === l.uid);
    if (p && !p.driven && p.role === l.role && flat(p.pos, l.pos) < sameR) return p;
  }
  let best: T | null = null,
    bd = nearR;
  for (const p of people) {
    if (p.driven || p.role === 'buddy' || p.role !== l.role) continue;
    const d = flat(p.pos, l.pos);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
