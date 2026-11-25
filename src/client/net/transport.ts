/**
 * Two-player networking. One small interface, three ways to carry it:
 *
 *  - `room`:   the claude.ai artifact viewer's live room capability (when the
 *              game is opened from its claude.ai link). Everything travels in
 *              each player's presence object, which every signed-in viewer
 *              may set, so a friend the artifact is shared with can play.
 *  - `webrtc`: PeerJS over WebRTC, using PeerJS's free public broker only to
 *              introduce the two browsers (any normal web deploy).
 *  - `local`:  BroadcastChannel between tabs of one browser (testing).
 *
 * Messages are small JSON. Each player publishes a STATE (where they are,
 * what they're doing) about ten times a second, plus EVENTS (chat, a spin,
 * a roll). Events carry a sequence number and the last few are repeated
 * with every state, so none are lost when presence updates are coalesced.
 */

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

async function roomTransport(cap: RoomCap, code: string): Promise<Transport> {
  const room = await cap.join(`lago-${code.toLowerCase()}`);
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

async function webrtcTransport(code: string, host: boolean): Promise<Transport> {
  const { Peer } = await import('peerjs');
  type Conn = import('peerjs').DataConnection;
  const id = `palazzo-lago-${code.toLowerCase()}`;
  const peer = host ? new Peer(id) : new Peer();
  const conns = new Map<string, Conn>();
  let handler: ((id: string, w: Wire | null) => void) | null = null;
  const attach = (c: Conn) => {
    conns.set(c.peer, c);
    c.on('data', (d) => handler?.(c.peer, d as Wire));
    c.on('close', () => {
      conns.delete(c.peer);
      handler?.(c.peer, null);
    });
  };
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
  if (host) peer.on('connection', (c) => c.on('open', () => attach(c)));
  else {
    const c = peer.connect(id, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No game with that code (or the host is offline)')), 12000);
      c.on('open', () => {
        clearTimeout(timer);
        attach(c);
        resolve();
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
    publish(w) {
      for (const c of conns.values()) if (c.open) c.send(w);
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

function localTransport(code: string): Transport {
  const me = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel(`palazzo-lago-${code}`);
  let handler: ((id: string, w: Wire | null) => void) | null = null;
  ch.onmessage = (m) => {
    const { from, w } = m.data as { from: string; w: Wire | null };
    if (from !== me) handler?.(from, w);
  };
  addEventListener('pagehide', () => ch.postMessage({ from: me, w: null }));
  return {
    kind: 'local',
    code,
    publish(w) {
      ch.postMessage({ from: me, w });
    },
    onRemote(fn) {
      handler = fn;
    },
    leave() {
      ch.postMessage({ from: me, w: null });
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
  if (force === 'local') return localTransport(code);
  if (force !== 'webrtc') {
    const cap = await roomCapability();
    if (cap) return roomTransport(cap, code);
  }
  return webrtcTransport(code, host);
}
