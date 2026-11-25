import { MAX_PLAYERS } from './party';

/**
 * Room networking for up to four players (host + three). One small
 * interface, three ways to carry it:
 *
 *  - `room`:   the claude.ai artifact viewer's live room capability (when the
 *              game is opened from its claude.ai link). Everything travels in
 *              each player's presence object, which every signed-in viewer
 *              may set, so a friend the artifact is shared with can play.
 *  - `webrtc`: PeerJS over WebRTC, using PeerJS's free public broker only to
 *              introduce the browsers (any normal web deploy). Guests connect
 *              to the host, which relays each guest's packets to the others.
 *  - `local`:  BroadcastChannel between tabs of one browser (testing).
 *
 * Messages are small JSON. Each player publishes a STATE (where they are,
 * what they're doing) about ten times a second, plus EVENTS (chat, a spin,
 * a roll). Events carry a per-sender sequence number and ride along with
 * every state until each friend acknowledges them (see `Outbox` in party.ts),
 * so none are lost when presence updates are coalesced.
 *
 * A fifth player is turned away with ROOM_FULL.
 */

export const ROOM_FULL = `That room is full (${MAX_PLAYERS} players max)`;

export interface PlayerState {
  name: string;
  host: boolean;
  look: number;
  x: number;
  z: number;
  /** Feet height (0 on the casino floor; lower in the pool, higher mid-jump). */
  y?: number;
  /** Body facing (person convention: atan2(dx, dz) of the walking direction). */
  yaw: number;
  pitch: number;
  moving: number;
  /** Viewpoint id when sitting/playing at a game. */
  seat: string | null;
  /** Sitting on a stool you walked onto: the seat's height (x, z are the stool's centre). */
  st?: number;
  chips: number;
  /** Voice chat switched on. */
  v?: boolean;
  /** Head height above the floor (VR), metres. */
  hh?: number;
  /** Real hand positions in VR (world, metres), when tracked. */
  lh?: number[] | null;
  rh?: number[] | null;
  /** Swimming (1) or not. */
  sw?: number;
  /** Crouching on the button: how far their eyes came down (m). */
  cr?: number;
  /** Mouth openness 0..9 (from the mic). */
  mo?: number;
  /** Grip squeeze per hand 0..1 (a fist when high). */
  lg?: number;
  rg?: number;
  /** Wrist pose per hand (world): x, y, z, qx, qy, qz, qw. Drives their real-looking hands. */
  lw?: number[] | null;
  rw?: number[] | null;
  /** The drink in your hand: [kind index, level 0-10, 0 = left hand / 1 = right]. */
  dh?: number[] | null;
  /** The loose object in their hand: [kind, colour, hand]. */
  lo?: number[] | null;
  /** Per-finger curls per hand, 5 digits [thumb,index,middle,ring,pinky] 0-9. */
  lf?: string;
  rf?: string;
  /** Chips won (+) or lost (−) tonight. */
  nt?: number;
  /** Dancing: move × 10 + how much (1-9); move 0 = legs only (a VR player's real hands do the arms). */
  dn?: number;
  /** Acks: for each friend (their id), the last event number handled from them. */
  a?: Record<string, number>;
  /** Host only: the colour slot of each guest (by id); the host is slot 0. */
  sl?: Record<string, number>;
}

export interface NetEvent {
  n: number;
  k: string;
  d?: unknown;
}

export interface Wire {
  s: PlayerState;
  e: NetEvent[];
}

export interface Transport {
  readonly kind: 'room' | 'webrtc' | 'local';
  readonly code: string;
  /** My id as the other players see it (keys their acks and the host's slot table). */
  readonly self: string;
  /** Publish my latest wire packet (state + recent events). */
  publish(w: Wire): void;
  /** A remote player's packet arrived (or `null`: they left). */
  onRemote(fn: (id: string, w: Wire | null) => void): void;
  leave(): void;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A fresh room code like "7K2F" (shown as LAGO-7K2F). */
export function newCode(): string {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((v) => ALPHABET[v % ALPHABET.length]).join('');
}

/** Accepts "lago-7k2f", "7K2F", "LAGO 7K2F" … → "7K2F", or null. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^LAGO/, '');
  if (s.length !== 4 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return s;
}

// ---------------------------------------------------------------------------
// claude.ai room capability
// ---------------------------------------------------------------------------

interface RoomPeer {
  peer: string;
  isMe: boolean;
  presence: Readonly<Record<string, unknown>>;
}
interface NamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(fn: (c: { peers: readonly RoomPeer[]; left: readonly RoomPeer[] }) => void, onError?: (e: { code: string }) => void): () => void;
  leave(): Promise<void>;
}
interface RoomCap {
  join(name: string): Promise<NamedRoom>;
}

/** Resolves the room capability when this page runs inside the claude.ai viewer. */
export async function roomCapability(): Promise<RoomCap | null> {
  const c = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!c?.use) return null;
  try {
    return (await c.use('room')) as RoomCap | null;
  } catch {
    return null;
  }
}

async function roomTransport(cap: RoomCap, code: string, host: boolean): Promise<Transport> {
  const room = await cap.join(`lago-${code.toLowerCase()}`);
  // Give the room a moment to list who's already in it, then count heads.
  if (!host && room.peers().filter((p) => !p.isMe).length === 0) await new Promise((r) => setTimeout(r, 500));
  if (room.peers().filter((p) => !p.isMe).length >= MAX_PLAYERS) {
    void room.leave();
    throw new Error(ROOM_FULL);
  }
  const self = room.peers().find((p) => p.isMe)?.peer ?? `me-${Math.random().toString(36).slice(2)}`;
  let handler: ((id: string, w: Wire | null) => void) | null = null;
  let pending: Wire | null = null;
  let sending = false;
  const flush = async () => {
    if (sending || !pending) return;
    sending = true;
    const w = pending;
    pending = null;
    try {
      await room.presence({ w: w as unknown as Record<string, unknown> });
    } catch {
      /* dropped; the next state replaces it */
    }
    sending = false;
    if (pending) void flush();
  };
  const seen = new Map<string, unknown>();
  const deliver = (peers: readonly RoomPeer[]) => {
    for (const p of peers) {
      if (p.isMe) continue;
      const w = p.presence.w as Wire | undefined;
      if (w && seen.get(p.peer) !== w) {
        seen.set(p.peer, w);
        handler?.(p.peer, w);
      }
    }
  };
  room.onPeers((c) => {
    deliver(c.peers);
    for (const p of c.left) {
      seen.delete(p.peer);
      handler?.(p.peer, null);
    }
  });
  return {
    kind: 'room',
    code,
    self,
    publish(w) {
      pending = w;
      void flush();
    },
    onRemote(fn) {
      handler = fn;
      deliver(room.peers());
    },
    leave() {
      void room.leave();
    },
  };
}

// ---------------------------------------------------------------------------
// WebRTC via PeerJS
// ---------------------------------------------------------------------------

/** Host → guest envelope: `w` from `f` (another guest; absent = the host itself), or a door answer. */
interface Envelope {
  f?: string;
  w?: Wire | null;
  ok?: boolean;
  full?: boolean;
}

async function webrtcTransport(code: string, host: boolean): Promise<Transport> {
  const { Peer } = await import('peerjs');
  type Conn = import('peerjs').DataConnection;
  const id = `palazzo-lago-${code.toLowerCase()}`;
  const peer = host ? new Peer(id) : new Peer();
  const conns = new Map<string, Conn>();
  let handler: ((id: string, w: Wire | null) => void) | null = null;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Could not reach the matchmaking server')), 12000);
    peer.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.on('error', (e: { type?: string; message?: string }) => {
      clearTimeout(timer);
      reject(new Error(e.type === 'unavailable-id' ? 'That room code is already in use' : e.type === 'peer-unavailable' ? 'No game with that code' : e.message ?? 'Connection failed'));
    });
  });
  if (host) {
    // The host is the hub: it hears every guest and passes each packet on to the others.
    const relay = (from: string, w: Wire | null) => {
      for (const [pid, c] of conns) if (pid !== from && c.open) c.send({ f: from, w } satisfies Envelope);
    };
    peer.on('connection', (c) =>
      c.on('open', () => {
        if (conns.size >= MAX_PLAYERS - 1) {
          c.send({ full: true } satisfies Envelope);
          setTimeout(() => c.close(), 400);
          return;
        }
        conns.set(c.peer, c);
        c.send({ ok: true } satisfies Envelope);
        c.on('data', (d) => {
          const w = d as Wire;
          if (!w || typeof w !== 'object' || !w.s) return;
          handler?.(c.peer, w);
          relay(c.peer, w);
        });
        c.on('close', () => {
          if (conns.get(c.peer) !== c) return;
          conns.delete(c.peer);
          handler?.(c.peer, null);
          relay(c.peer, null);
        });
      }),
    );
  } else {
    const c = peer.connect(id, { reliable: true });
    const relayed = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No game with that code (or the host is offline)')), 12000);
      c.on('data', (d) => {
        const m = d as Envelope;
        if (m.full) {
          clearTimeout(timer);
          reject(new Error(ROOM_FULL));
          peer.destroy();
          return;
        }
        if (m.ok) {
          clearTimeout(timer);
          conns.set(id, c);
          resolve();
          return;
        }
        if (m.w === undefined) return;
        const from = m.f ?? c.peer;
        if (m.f) {
          if (m.w) relayed.add(m.f);
          else relayed.delete(m.f);
        }
        handler?.(from, m.w);
      });
      c.on('close', () => {
        conns.delete(id);
        // The hub is gone: so is everyone it was relaying.
        for (const r of relayed) handler?.(r, null);
        relayed.clear();
        handler?.(c.peer, null);
      });
      peer.on('error', (e: { type?: string }) => {
        clearTimeout(timer);
        reject(new Error(e.type === 'peer-unavailable' ? 'No game with that code' : 'Connection failed'));
      });
    });
  }
  return {
    kind: 'webrtc',
    code,
    self: peer.id,
    publish(w) {
      // Guests send plain packets to the host; the host wraps its own for the relay.
      for (const c of conns.values()) if (c.open) c.send(host ? ({ w } satisfies Envelope) : w);
    },
    onRemote(fn) {
      handler = fn;
    },
    leave() {
      peer.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// Same-browser tabs (testing)
// ---------------------------------------------------------------------------

interface LocalMsg {
  from: string;
  w?: Wire | null;
  /** Door: "who's in?" and the answers. */
  hello?: boolean;
  here?: boolean;
  to?: string;
  host?: boolean;
}

/**
 * Same-browser tabs over a BroadcastChannel (testing). Everyone hears
 * everyone; on the way in a tab asks who's there, so a fifth is turned away
 * and a code nobody is hosting says so.
 */
export async function localTransport(code: string, host: boolean, wait = 350): Promise<Transport> {
  const me = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel(`palazzo-lago-${code}`);
  let handler: ((id: string, w: Wire | null) => void) | null = null;
  let inside = false;
  const present = new Map<string, boolean>();
  ch.onmessage = (m) => {
    const msg = m.data as LocalMsg;
    if (!msg || msg.from === me) return;
    if (msg.hello) {
      if (inside) ch.postMessage({ from: me, here: true, to: msg.from, host } satisfies LocalMsg);
      return;
    }
    if (msg.here) {
      if (msg.to === me) present.set(msg.from, !!msg.host);
      return;
    }
    if (inside && msg.w !== undefined) handler?.(msg.from, msg.w);
  };
  ch.postMessage({ from: me, hello: true } satisfies LocalMsg);
  await new Promise((r) => setTimeout(r, wait));
  if (present.size >= MAX_PLAYERS) {
    ch.close();
    throw new Error(ROOM_FULL);
  }
  if (!host && ![...present.values()].some(Boolean)) {
    ch.close();
    throw new Error('No game with that code');
  }
  inside = true;
  const bye = () => {
    try {
      ch.postMessage({ from: me, w: null } satisfies LocalMsg);
    } catch {
      /* closed */
    }
  };
  globalThis.addEventListener?.('pagehide', bye);
  return {
    kind: 'local',
    code,
    self: me,
    publish(w) {
      if (inside) ch.postMessage({ from: me, w } satisfies LocalMsg);
    },
    onRemote(fn) {
      handler = fn;
    },
    leave() {
      bye();
      inside = false;
      ch.close();
    },
  };
}

/**
 * Connect to a room: the claude.ai room when available, else WebRTC.
 * `?net=local` forces same-browser tabs (for testing).
 */
export async function connect(code: string, host: boolean): Promise<Transport> {
  const force = new URLSearchParams(location.search).get('net');
  if (force === 'local') return localTransport(code, host);
  if (force !== 'webrtc') {
    const cap = await roomCapability();
    if (cap) return roomTransport(cap, code, host);
  }
  return webrtcTransport(code, host);
}
