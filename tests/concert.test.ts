import { describe, expect, it } from 'vitest';
import concertJson from '../scripts/concert-lines.json?raw';
import voiceIndex from '../public/voices/index.json?raw';
import castJson from '../tools/voices/eleven-cast.json?raw';
import elevenJson from '../tools/voices/eleven-lines.json?raw';
import * as THREE from 'three';
import { GUESTS, SPEAKERS, elVoice } from '../src/client/cast';
import { Person, Crowd } from '../src/client/people';
import { STAGE, POOL } from '../src/client/areas/pool';
import { CONCERT, CREW_PARTY, GAMBLING, MC, NIXIE, PARTY_PHASES, concertLinesOf, concertReplyLabels, nixieLines } from '../src/client/party/concertlines';
import { chatterPool, onStage, partyReactions, partySafe, phaseAt, silent } from '../src/client/party/partytalk';
import { backAt, backCount, backSpots } from '../src/client/party/backcrowd';
import { ConcertHype } from '../src/client/party/hype';
import { audienceSpots } from '../src/client/party/audience';
import { renderCrowdSfx, CROWD_SFX } from '../src/client/party/crowdsfx';
import { REACTIONS } from '../src/client/reactlines';
import { lineId } from '../src/client/speech';
import { plainArrangement, beatAt } from '../src/client/party/beat';

const look = { dress: false, main: 0, second: 0, skin: 0, hair: 0, hairStyle: 'short' as const, height: 1.8 };

describe('the party talks about the show', () => {
  const all = [...Object.values(CONCERT).flatMap(concertLinesOf), ...nixieLines(), ...Object.values(CREW_PARTY).flat(), ...concertReplyLabels()];

  it('turns to "one minute!" once the DJ has called her', () => {
    for (const ch of GUESTS) {
      const s = CONCERT[ch.id];
      expect(s.minute.length, ch.id).toBeGreaterThan(0);
      for (const t of s.minute) expect(/one (more )?minute|sixty seconds/i.test(t), t).toBe(true);
      const pool = chatterPool(ch.id, 'soon');
      expect(pool.filter((t) => s.minute.includes(t)).length / pool.length).toBeGreaterThan(0.5);
      expect(chatterPool(ch.id, 'dj').some((t) => s.minute.includes(t))).toBe(false);
    }
    expect(CREW_PARTY.soon.some((t) => /one minute|sixty seconds/i.test(t))).toBe(true);
  });

  it('has the DJ call her a minute out, in a cast voice, ready to record (a caption until then)', () => {
    expect(MC.call).toMatch(/one minute/i);
    expect(MC.call).toMatch(/nixie vale/i);
    expect(partySafe(MC.call)).toBe(true);
    expect(SPEAKERS.find((s) => s.id === MC.id)?.voiceHint).toBe(MC.voiceHint);
    const cast = JSON.parse(castJson) as Record<string, { voice_id: string }>;
    expect(cast[elVoice(MC.id)]?.voice_id).toBeTruthy();
    const v = elVoice(MC.id),
      id = lineId(v, MC.call);
    const rec: Record<string, Record<string, number>> = JSON.parse(voiceIndex).voices;
    const concert = JSON.parse(concertJson) as { lines: { voice: string; id: string }[] };
    const eleven = JSON.parse(elevenJson) as { voice: string; id: string }[];
    if (rec[v]?.[id] === undefined) {
      expect(concert.lines.some((l) => l.voice === v && l.id === id)).toBe(true);
      expect(eleven.some((l) => l.voice === v && l.id === id)).toBe(true);
    }
  });

  it('has a set for every regular, every moment of the night', () => {
    for (const ch of GUESTS) {
      const s = CONCERT[ch.id];
      expect(s, ch.id).toBeTruthy();
      for (const ph of PARTY_PHASES) expect(chatterPool(ch.id, ph).length, `${ch.id} ${ph}`).toBeGreaterThan(1);
      for (const k of ['pushed', 'doused', 'hit', 'punched'] as const) expect(s.react[k].length).toBeGreaterThan(0);
    }
    expect(all.length).toBeGreaterThan(300);
  });

  it('never mentions the casino floor (tables, chips, slots, betting, winning...)', () => {
    for (const t of all) expect(GAMBLING.test(t), t).toBe(false);
    // (And the filter does catch the floor's talk.)
    for (const t of ['Up three hundred on blackjack.', 'Place your bets!', "I'm on a hot streak at the craps table", 'Feeling lucky?', 'Cash in your chips'])
      expect(partySafe(t), t).toBe(false);
  });

  it('is about the concert: her, the song, the band, the DJ, the stage', () => {
    const show = /nixie|chasing dawn|show|concert|stage|band|sing|song|dj|lights|front|chorus|encore|set|music|whoo|bravo|brava|voice|dance|bass|speakers|headliner|star|fan/i;
    const lines = Object.values(CONCERT).flatMap((s) => [...s.soon, ...s.live, ...s.after, ...s.dj]);
    const about = lines.filter((t) => show.test(t)).length;
    expect(about / lines.length).toBeGreaterThan(0.7);
    for (const s of Object.values(CONCERT)) expect(s.soon.some((t) => /is she on yet|chasing dawn|any minute|on soon|coming on|couple of minutes/i.test(t))).toBe(true);
  });

  it('only her show lines for her, and a voice brief to cast her with', () => {
    expect(SPEAKERS.find((s) => s.id === NIXIE.id)?.voiceHint).toBe(NIXIE.voiceHint);
    for (const t of nixieLines()) expect(partySafe(t), t).toBe(true);
  });

  it('pushed at the party: their recorded show lines first, else their usual ones that are fine at a concert', () => {
    const own = CONCERT.vinnie.react.pushed;
    const usual = [...REACTIONS.vinnie.pushed, 'Hey, I was about to win at the table!'];
    expect(partyReactions(own, usual, () => true)).toEqual(own);
    const fallback = partyReactions(own, usual, (t) => !own.includes(t));
    expect(fallback.length).toBeGreaterThan(0);
    for (const t of fallback) expect(partySafe(t)).toBe(true);
    expect(partyReactions(own, usual, () => false)).toEqual([]);
  });
});

describe('the performers say nothing while they perform', () => {
  it('she is hushed on stage, the band and the DJ always', () => {
    const her = new Person('watch', look);
    her.performer = 'singer';
    expect(silent(her)).toBe(false);
    her.hush = true;
    expect(silent(her)).toBe(true);
    const drums = new Person('watch', look);
    drums.performer = 'band';
    expect(silent(drums)).toBe(true);
    const guest = new Person('watch', look);
    expect(silent(guest)).toBe(false);
  });

  it('she is on stage from her walk-on to the end of her set', () => {
    expect(onStage({ ready: true, live: false, toLive: 30, bar: 2 })).toBe(false);
    expect(onStage({ ready: true, live: false, toLive: 3, bar: 2 })).toBe(true);
    expect(onStage({ ready: true, live: true, toLive: 0, bar: 2 })).toBe(true);
    expect(onStage({ ready: false, live: false, toLive: 3, bar: 2 })).toBe(false);
  });

  it('the hype hushes her from her walk-on through her set, and lets her talk again after', () => {
    const singer = new Person('watch', look);
    singer.performer = 'singer';
    const dj = new Person('watch', look);
    dj.performer = 'dj';
    const keys = new Person('watch', look);
    keys.performer = 'band';
    const played: string[] = [];
    const sound = {
      play: (n: string) => (played.push(n), null),
      ambientAt: () => ({ gain: { gain: { setTargetAtTime() {} } } }),
      listener: { context: { currentTime: 0 } },
    };
    const crowd = { people: [], tierPeople: 34, react() {} };
    const hype = new ConcertHype({ scene: new THREE.Scene(), sound: sound as never, crowd: crowd as never, audience: null, singer, band: [keys], dj });
    expect(dj.hush && keys.hush).toBe(true);
    const arr = plainArrangement(128, 64);
    const step = (o: { live: boolean; toLive: number; song?: number }) =>
      hype.update(0.1, { beat: beatAt(1, arr), onBeat: false, onBar: false, ready: true, live: o.live, song: o.song ?? (o.live ? 0 : -1), into: o.live ? 10 : -1, toLive: o.toLive, bar: 1.875, called: !o.live && o.toLive < 75, presence: 1, you: new THREE.Vector3() });
    step({ live: false, toLive: 120 });
    expect(hype.phase).toBe('dj');
    // The DJ calls her: a cheer, and the crowd's on "one minute!".
    hype.called(true);
    expect(hype.log).toContain('called');
    step({ live: false, toLive: 70 });
    expect(singer.hush).toBe(false);
    expect(hype.phase).toBe('soon');
    step({ live: false, toLive: 3 });
    expect(singer.hush).toBe(true);
    expect(played).toContain('crowdRoar');
    step({ live: true, toLive: 0 });
    expect(singer.hush).toBe(true);
    expect(hype.phase).toBe('live');
    step({ live: false, toLive: 200 });
    expect(singer.hush).toBe(false);
    expect(hype.phase).toBe('after');
    expect(silent(singer)).toBe(false);
  });

  it('knows the moment of the night', () => {
    expect(phaseAt({ live: true, song: 0, toLive: 0, sinceEnd: Infinity })).toBe('live');
    expect(phaseAt({ live: true, song: -1, toLive: 0, sinceEnd: Infinity })).toBe('after');
    expect(phaseAt({ live: false, song: -1, toLive: 200, sinceEnd: 20 })).toBe('after');
    // From the DJ's call ("in one minute"): told, or by the time left.
    expect(phaseAt({ live: false, song: -1, toLive: 70, sinceEnd: Infinity })).toBe('soon');
    expect(phaseAt({ live: false, song: -1, toLive: 100, sinceEnd: Infinity })).toBe('dj');
    expect(phaseAt({ live: false, song: -1, toLive: 100, sinceEnd: Infinity, called: true })).toBe('soon');
    expect(phaseAt({ live: false, song: -1, toLive: 70, sinceEnd: Infinity, called: false })).toBe('dj');
    expect(phaseAt({ live: false, song: -1, toLive: 200, sinceEnd: 200 })).toBe('dj');
  });
});

describe('more people at her show', () => {
  it('more than doubles her audience, and packs the front rows', () => {
    expect(Crowd.concertExtras(66)).toBeGreaterThanOrEqual(16);
    expect(Crowd.concertExtras(34)).toBeGreaterThanOrEqual(10);
    const s = audienceSpots(() => true);
    const front = s.filter((v) => v.y < STAGE.z1 + 1.2);
    expect(front.length).toBeGreaterThanOrEqual(11);
    expect(s.length).toBeGreaterThan(40);
  });

  it('fills the deck behind them with dozens more (fewer on headsets and phones), clear of the stage and the pool', () => {
    expect(backCount(66)).toBeGreaterThan(backCount(46));
    expect(backCount(34)).toBeGreaterThanOrEqual(30);
    const spots = backSpots(() => true, backCount(66));
    expect(spots.length).toBe(backCount(66));
    for (const v of spots) {
      expect(v.y).toBeGreaterThan(STAGE.z1 + 3);
      expect(v.y).toBeLessThan(POOL.z - POOL.d / 2);
    }
    // Arriving from before her set, all there a minute and a half in, gone again after.
    expect(backAt(-30, 5, 10, -40, NaN).f).toBe(0);
    expect(backAt(-30, 5, 10, 90, NaN).f).toBe(1);
    expect(backAt(-30, 5, 10, NaN, 60).f).toBe(0);
    expect(backAt(-30, 5, 10, NaN, 8).walking).toBe(true);
  });

  it("synthesizes the crowd's whoops, claps and roar", () => {
    for (const n of CROWD_SFX) {
      const v = renderCrowdSfx(n, 8000);
      expect(v.length).toBeGreaterThan(0);
      for (const d of v) {
        let peak = 0;
        for (const x of d) {
          expect(Number.isFinite(x)).toBe(true);
          peak = Math.max(peak, Math.abs(x));
        }
        expect(peak, n).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('every new line is ready for the recording session', () => {
  it('scripts/concert-lines.json lists every new line not yet recorded, in a voice of the right gender', () => {
    const j = JSON.parse(concertJson);
    const rec: Record<string, Record<string, number>> = JSON.parse(voiceIndex).voices;
    const listed = new Set<string>(j.lines.map((l: { voice: string; id: string }) => l.voice + '/' + l.id));
    for (const ch of GUESTS) {
      const v = elVoice(ch.id);
      for (const t of concertLinesOf(CONCERT[ch.id])) {
        const id = lineId(v, t);
        if (rec[v]?.[id] === undefined) expect(listed.has(v + '/' + id), `${v}: ${t}`).toBe(true);
      }
    }
    for (const l of j.lines as { voice: string; gender: string; id: string; text: string }[]) {
      expect(l.id).toBe(lineId(l.voice, l.text));
      const ch = GUESTS.find((g) => elVoice(g.id) === l.voice);
      if (ch) expect(l.gender).toBe(ch.gender);
    }
    for (const t of nixieLines()) expect(listed.has(elVoice('nixie') + '/' + lineId(elVoice('nixie'), t)) || rec.el_nixie?.[lineId('el_nixie', t)] !== undefined).toBe(true);
  });
});
