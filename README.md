# Palazzo Lago Casino

A VR-first luxury casino that also runs in any web browser. Built with TypeScript, Three.js and WebXR.
Play money only.

**Built so far:** a casino you walk around in. The hall, American roulette with a croupier, four
playable slot machines (Diamond Sevens, Lago Fortuna, Royal Conservatory, and Porkbelly Payday: mystery crates
turn into one symbol and flick Blue, Yellow and Red coins up to three piggy banks that fatten and set
off free-spin bonuses: banked spins, six collectable jackpots, and reels with low symbols crossed out) plus two rows of machines
played by guests, Bar Lago (order a drink, hold it, sip it), a grand piano with a pianist playing live,
and French doors onto a terrace over the lake fountains. About 40 guests and staff wander, play,
cheer and look at you.

**Craps** is a full Strip game on a 12-ft table with a boxman, two dealers and a stickman who calls
every roll: Pass/Don't Pass, Come/Don't Come (bets travel to the numbers), 3-4-5x odds and 6x lay
odds, Place bets (9:5, 7:5, 7:6), a Field paying double on 2 and triple on 12, Big 6/8, hardways and
the one-roll props, $10 table minimum. The dice are thrown with real rigid-body physics (19 mm cubes
off the felt and the rubber pyramids on the back wall); in VR you pick them up and throw them yourself.

**Two players:** pick a character on the start screen (cycle through them or hit Random), then play
solo, **host** a room (you get a code like `LAGO-7K2F`) or **join** a friend's room with their code. You
see each other on the floor with name tags and chat bubbles (press T), big wins are announced, and
roulette and craps are shared tables: the host's machine spins and rolls for both of you, either player
can call the spin or shoot the dice, and each bets their own chips. On the claude.ai link the game uses
the artifact's live room (your friend needs access to the artifact); anywhere else it connects the two
browsers directly over WebRTC (PeerJS's free public broker introduces them). Add `?net=local` to test
with two tabs of one browser.

**Being there together:** voice chat (Voice button, or Room on your VR wrist; V mutes) plays your
friend's voice from their avatar. In VR their avatar's arms follow their real hands, their head
follows where they look, and its mouth moves when they talk (from their mic level). Slap hands in
VR for a high five. Every screen menu is also in VR: press **Y** on the left controller to open it on your left wrist: Go (map), Room (host, join
with a code keypad, character, voice, quick chat) and Menu (music, sound, help, reset chips, exit VR).
Tables and machines are walk-up-and-play: stand at one and its controls appear; sitting is optional.

It plays like a night out with the guys: your crew (Rocco, Dev and Mikey) follow you around, hype your
wins and razz your losses; there's a casino-floor groove, hot streaks, big-win celebrations with confetti,
and six goals for the night (win at roulette, hit a slot bonus, buy the boys a round, tip the piano man,
catch the fountain finale, finish up $1,000).

Runs on desktop, phones (portrait or landscape) and Meta Quest.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 in a desktop browser
npm test             # rules engine + exact slot math
npm run build        # static site in dist/
```

### On a Meta Quest

WebXR needs HTTPS, so for local testing:

```bash
npm run dev:quest
```

Open the printed `https://<your-computer-ip>:5173` address in the Quest browser, accept the
self-signed certificate warning, then press **Enter VR**. For a permanent link, deploy `dist/` to any
static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages).

Add `?stats` to the URL for an fps / draw-call counter, and `?quality=quest2|quest3|desktop|mobile`
to force a quality tier.

## Controls

| | Desktop | VR |
| --- | --- | --- |
| Phone | Left thumb stick walks, drag anywhere to look, tap to play; the gold button sits/stands/sips; big on-screen chips and SPIN at a game | |
| Move | Mouse look, WASD (Shift to hurry); Esc frees the cursor (then drag to look, click the floor to walk); M opens the map | Left stick walks, right stick snap-turns, point at the floor + trigger to teleport, wrist menu (left hand) |
| Sit down | Walk up to a game and press E; walk away to stand | Just walk up |
| Roulette | Pick a chip (or keys 1–7), click the layout; Space spin, Z undo, C clear, R rebet | Grab chips from your rack (grip) and drop them on the felt, or point and trigger |
| Slots | − / + bet, SPIN (or click the screen), Info for paytable | Same with the laser; grab and pull the lever on Diamond Sevens |
| Bar & piano | Click the bar to order (free), click the glass to pick it up, F sip, Q set down; click the tip jar | Point at the bar, grab the glass, raise it to your mouth to sip |

## Layout

```
src/rules/      pure game logic, no graphics (runs unchanged on a future server)
  roulette.ts   American wheel, every bet type, limits, settlement
  slots.ts      slot engine, exact RTP analysis, free spins, pick bonus
  machines.ts   the three machines' reel strips and paytables
  bankroll.ts   shared play-money balance and stats
  rng.ts        crypto RNG (play) and seeded RNG (tests)
src/client/     Three.js app
  casino.ts     the hall: floor, carpet, ceiling, columns, chandeliers, glass flowers, lake view
  roulette/     table, wheel, ball animation, felt layout + hit testing
  slots/        cabinets, reels, symbol art
  interaction.ts  one select path for mouse, touch, VR controllers and hands
  player.ts     first-person walking, sitting, VR locomotion and comfort vignette
  world.ts      walkable areas, collisions and floor surfaces (for footsteps)
  people.ts     guests and staff: instanced bodies, walk/sit/cheer/deal/pour poses, wandering
  hands.ts      VR controller/hand models and grabbing
  lounge.ts     Bar Lago, drinks, lounge seating, grand piano
  decor.ts      the slot rows played by guests
  crew.ts       your three buddies: following, banter, reactions
  night.ts      tonight's goals, hot streaks, big-win celebrations and confetti
  touch.ts      phone joystick and context button
  merge.ts      static-mesh merging (keeps draw calls inside the Quest budget)
tests/          vitest suites
scripts/        RTP report and reel-strip tuner
art/LICENSES.md asset licence log
```

## Slot math

Every machine's return to player (RTP) is computed exactly (not sampled) and checked in CI:
Diamond Sevens 95.0%, Lago Fortuna 92.0%, Royal Conservatory 90.0%. Run `npm run rtp` for the breakdown.

## Performance budgets (Quest 3 reference, Quest 2 supported)

Measured with `?stats`: lobby ~90 draw calls per eye-pair render on the Quest 3 tier, roulette ~45, slots ~60;
triangles under 200k. Budget: 150 draws, 750k triangles. Quest 2 uses half-size textures, fewer chandelier
crystals and glass flowers, and no extra point lights.
