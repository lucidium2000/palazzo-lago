import { describe, expect, it } from 'vitest';
import { makeKeys, modPow, seal, sharedSecret, unseal } from '../src/client/net/pokerkeys';

describe('private hole cards', () => {
  it('modPow', () => {
    expect(modPow(4n, 13n, 497n)).toBe(445n);
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
  });

  it('host and guest derive the same secret; a third player cannot', () => {
    const host = makeKeys(),
      guest = makeKeys(),
      other = makeKeys();
    const a = sharedSecret(host.priv, guest.pub);
    const b = sharedSecret(guest.priv, host.pub);
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(sharedSecret(other.priv, host.pub)).not.toBe(a);
    expect(sharedSecret(other.priv, guest.pub)).not.toBe(a);
  });

  it('seals and unseals card ids; other secrets or another hand read garbage', () => {
    const host = makeKeys(),
      guest = makeKeys(),
      other = makeKeys();
    const s = sharedSecret(host.priv, guest.pub)!;
    const cards = [12, 51];
    const box = seal(s, 'hand7', cards);
    expect(box).not.toEqual(cards);
    expect(unseal(s, 'hand7', box)).toEqual(cards);
    expect(unseal(s, 'hand8', box)).not.toEqual(cards);
    expect(unseal(sharedSecret(other.priv, host.pub)!, 'hand7', box)).not.toEqual(cards);
    // The same cards in two hands look different on the wire.
    expect(seal(s, 'hand8', cards)).not.toEqual(box);
  });

  it('rejects bad public keys', () => {
    const k = makeKeys();
    expect(sharedSecret(k.priv, '1')).toBeNull();
    expect(sharedSecret(k.priv, 'zz')).toBeNull();
    expect(sharedSecret(k.priv, '')).toBeNull();
  });
});
