/**
 * Private hole cards at a shared table. Everything in a room goes to every
 * player, so the host can't just "send" a guest their cards: each guest
 * makes a Diffie-Hellman key pair (2048-bit MODP group, RFC 3526 group 14,
 * with a 256-bit secret exponent) and publishes the public half; the host
 * does the same; each side derives the same shared secret, which nobody else
 * in the room can. The host then seals a guest's two cards with a keystream
 * drawn from that secret and the hand number, so only that guest can read
 * them. Play money among friends: this keeps honest friends' screens (and a
 * curious look at the network log) from showing anyone else's cards; it's
 * plain BigInt maths, so it works without WebCrypto (e.g. on a LAN over http).
 */

const P = BigInt(
  '0x' +
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AACAA68FFFFFFFFFFFFFFFF',
);
const G = 2n;

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export interface KeyPair {
  priv: bigint;
  /** Public half, hex: safe to publish. */
  pub: string;
}

/** A fresh key pair. `random` fills bytes (defaults to crypto.getRandomValues). */
export function makeKeys(random: (a: Uint8Array<ArrayBuffer>) => void = (a) => void globalThis.crypto.getRandomValues(a)): KeyPair {
  const bytes = new Uint8Array(32);
  random(bytes);
  const priv = BigInt('0x' + hex(bytes)) | (1n << 255n);
  return { priv, pub: modPow(G, priv, P).toString(16) };
}

/** The secret both sides of a pair share (hex), or null for a bad public key. */
export function sharedSecret(priv: bigint, otherPub: string): string | null {
  if (typeof otherPub !== 'string' || !/^[0-9a-f]{1,600}$/i.test(otherPub)) return null;
  const y = BigInt('0x' + otherPub);
  if (y <= 1n || y >= P - 1n) return null;
  return modPow(y, priv, P).toString(16);
}

/** cyrb128: a string to four 32-bit seeds. */
function seeds(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Keystream bytes for (secret, nonce): sfc32 seeded from the whole secret, warmed up. */
function keystream(secret: string, nonce: string, n: number): number[] {
  let [a, b, c, d] = seeds(`${secret}|${nonce}|${secret.length}`);
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 24; i++) next();
  const out: number[] = [];
  while (out.length < n) {
    const v = next();
    out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24);
  }
  return out.slice(0, n);
}

/** Seals small numbers (0..255, e.g. card ids) for whoever holds `secret`. */
export function seal(secret: string, nonce: string, data: readonly number[]): number[] {
  const k = keystream(secret, nonce, data.length);
  return data.map((v, i) => (v ^ k[i]) & 255);
}

export const unseal = seal;
