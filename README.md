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

**Poker room:** a private card salon through a doorway in the west wall: no-limit Texas Hold'em,
$5/$10 blinds, a dealer and six-seat oval table where regulars (each with their own style: loose,
tight, aggressive, a bluffer) fill every chair a player isn't in. Buy in from your chips, cash out
when you stand. In VR it's all hands: cup your cards to peek, knock twice to check, sweep them to the
dealer to fold, push chips over the line to call or raise. With friends, the host deals and seals each
player's hole cards so only they can read them (`net/pokerkeys.ts`); cards show at the showdown.

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
follows where they look, and its mouth moves when they talk (from their mic level). In VR you see your own body and
hands, and you can high five (open hands up high), fist bump (squeeze grips and bump) and shake hands
(hold hands at waist height); screen players offer the same from the chat bar. Every screen menu is also in VR: press **Y** on the left controller to open it on your left wrist: Go (map), Room (host, join
with a code keypad, character, voice, quick chat) and Menu (music, sound, help, reset chips, exit VR).
Tables and machines are walk-up-and-play: stand at one and its controls appear; sitting is optional.

**Beyond the casino:** a corridor off the east wall leads to the hotel elevator lobby. Call a car,
step in and ride up to Suite 3201 (floor-to-ceiling windows on the Strip) or down to the night pool
deck: lit pools, palms, cabanas, a pool bar and a DJ. The car's **M** button takes you to the Promenade, the
restaurant and shopping level: a marble concourse under skylights that ends at a glass balcony over a
garden atrium, a food court (pizza, burgers, noodles, gelato: order at the counter, pick it up, eat it
bite by bite; the cooks, Tony, Duke, Mei and Lucia, call your order in their own voices), the Lago Luxe boutique (sunglasses and fedoras to buy with chips and wear, so your
friends see them; Simone rings you up) and the Lago Arcade, each with its own sound: a crowd murmur and
grills sizzling on the concourse, a soft electronic hum and far-off bleeps in the arcade, the casino's
music only a quiet bed up here. Every bite of food and every drink you can see is real: take a
slice off a pie on the pizza pass, a cone out of the gelato case, a diner's burger or soda off their
table (they'll say something), a bottle off the back bar or the pool bar's column, a decanter in the poker
room, a lime from the garnish bowl, the drink out of a guest's hand; then eat it, sip it, pour it, mix it,
throw it. The floor is alive: guests chat in circles with
drinks in hand, friends walk together, people stop to talk and take photos, and they mostly mind their
own business instead of staring at you.

**The Lago Arcade:** six original upright cabinets, $1 a play: **Neon Sentinel** (fly a hover-turret
and shoot down drone swarms diving at your three beacons; Hive motherships every fifth wave), **Prism
Drop** (falling gem pairs, four or more shatter and chain; rock rises from below and cracks next to
clears; a Lucky Chip clears a whole colour), **Rake & Break** (the croupier's rake and a roulette ball
against chips and playing cards that flip then break; face cards drop favours), **Midnight Strip**
(a night drive through traffic against the clock, nitro from gold chips), **Velvet Beat** (one-button
lounge drumming in time with the band) and **Splash Rally** (pool paddle tennis against the pool's
champions, or a friend on the second controls). Each has attract mode, a high-score table with
joystick initials (the room's host keeps the tables) and its own chiptune. In VR you grab the stick
and press the buttons with your fingers; on a screen walk up and the keys (or touch buttons) play.
On the floor: **Skyline Hoops** (45 seconds, real throws), **Puck Palazzo** air hockey (the house
or a friend) and the **Lucky Claw** (win a plush pal to carry and toss: it's a real loose thing, so friends see it in your
hand and wherever you throw it). Friends nearby watch your screen live, see the same puck and score,
and the same claw run. The sticks and buttons belong to the machines, not to a player: a friend who
steps up while you play presses into your game (or takes player 2 on Splash Rally, the far end of the
hockey table), and if you walk off, or drop out of the room, whoever is at the controls carries on the
same game from where it was.

**Featured cabinet: The Last Mile** (by Christopher G. Hunt, MIT; [thelastmile.live](http://thelastmile.live)), on a
wide 16:9 cabinet against the arcade's east wall, free to play. It's the real web game: a copy in
`public/arcade/lastmile/` (refresh it with `node scripts/sync-lastmile.mjs [path/to/the-last-mile]`) runs in a hidden
iframe while you're near, driven frame by frame from the room's loop (so it keeps going inside the
headset), and its screen is copied onto the cabinet. Stick and CROSS / SOUND buttons in VR; on a screen walk up
and your keys, clicks, taps and swipes go to the game. Its sound comes from the cabinet; friends nearby see a
small live picture of your game.

**Hands and talk:** in VR your avatar's fingers follow your real ones: the Quest controllers'
touch sensors (trigger touch and pull for the index finger, grip for the rest, thumb on the stick /
buttons / thumb rest) or full hand tracking (25 joints per hand). Walk up to craps in VR and the
stickman slides you the dice: grab them and throw at the far wall. Push the stick further to run;
click it to sprint. Guests talk to each other (bubbles and voices nearby) and to you when you stop
and look at them; answer with reply buttons (keys 1-3, or the floating panel in VR).

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
| Food court | Click a dish on a counter's menu, click the food when it's up, F bite (X throw, Q set down) | Point at the menu and pull the trigger, grab the food, hold it to your mouth for each bite |
| Food and drink on show | Click it (a slice on the pie, a tub in the gelato case, a bottle on the back bar, a guest's drink): it's in your hand; F bite / sip / swig, hold P to pour | Reach out and close your hand on it; out of reach (the back bar, the grill), point at it and pull the trigger and it comes to your hand |
| Boutique | Click an item to pick it up, click the register to pay, F put it on, U take it off | Grab it, hold it to the register (or point at it), then hold shades to your eyes or a hat on your head; grab at your head to take it off |
| Grand piano | Click the pianist to push him off the bench, then sit (E, or walk onto the bench): A S D F G H J K L white keys, W E T Y U O P black, Z / X octave, Space sustain, Shift louder, Esc stand; or click / tap the keys | Shove (or punch) him off, sit on the bench: every fingertip that presses a key plays it, as hard as it came down (hand tracking: all ten; controllers: index and thumb, the whole hand when open); A / X is the sustain pedal |

## Layout

```
src/rules/      pure game logic, no graphics (runs unchanged on a future server)
  roulette.ts   American wheel, every bet type, limits, settlement
  poker.ts      Hold'em: hand ranking, blinds, no-limit betting, side pots, NPC decisions
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
  areas/        the hotel, pool, suite and Promenade, the elevators (liftlogic.ts is their pure logic)
  areas/promenade.ts  the Promenade floor; ARCADE_SLOTS and the mountArcade hook for src/client/arcade/
  arcade/       the arcade: games/ (six cabinet games, pure logic + canvas drawing), machine.ts (coin,
                attract, initials), cabinet.ts / controls.ts (3D cabinets, sticks and buttons),
                synth.ts (chiptunes), hoops / hockey / claw (+ their *phys / *logic), net.ts
  arcade/lastmile/  the featured cabinet: host.ts (the game's iframe, rAF and audio takeover), logic.ts
                (frame queue, keys, rates; pure), art.ts, index.ts (cabinet, controls, friends' view)
  promenadelife.ts    food court ordering, the boutique's register, what you wear (and your friends see)
  promenadelines.ts   the cooks' and the clerk's lines (one fixed line per dish, for recording)
  promenadeaudio.ts   the Promenade's murmur, grills, kitchen clatter and arcade room tone (synthesized)
  loose.ts      loose things to pick up and throw (chips, bottles, fruit, food, shop stock), loosephys.ts their physics
  stock.ts      food and drink on show: drawn instanced, promoted to a real loose thing or glass when taken,
                restocked later, capped; stockdisplays.ts says what's on show where
  areas/entrance.ts   the Main Entrance (floor G): lobby, porte-cochère, taxi line, rideshare bays, the Strip;
                      entranceplan.ts (layout, paths, schedule; pure), entrancetraffic.ts (the cars and guests
                      on one shared wall clock; pure), entrancecars.ts (instanced low-poly cars, emissive lamps)
  entranceaudio.ts    street sound out front: city bed, idling engines, pass-bys, horns, doors, valet whistle
  piano.ts      the playable piano: 88 keys, fingertips / typing / taps, the pianist's bench
  pianokeys.ts  keyboard layout, hit detection, fingertip strikes, voice allocation (pure)
  pianotone.ts  synthesized piano notes (pianoworker.ts renders them), pianosynth.ts plays them
  decor.ts      the slot rows played by guests
  crew.ts       your three buddies: following, banter, reactions
  night.ts      tonight's goals, hot streaks, big-win celebrations and confetti
  touch.ts      phone joystick and context button
  merge.ts      static-mesh merging, colour merging, sprite batching (keeps draw calls down)
  cull.ts       portal and tiny-detail culling; resortcull.ts has the resort's cells and doorways
tests/          vitest suites
scripts/        RTP report and reel-strip tuner; sync-lastmile.mjs copies The Last Mile into public/
art/LICENSES.md asset licence log
```

## Slot math

Every machine's return to player (RTP) is computed exactly (not sampled) and checked in CI:
Diamond Sevens 95.0%, Lago Fortuna 92.0%, Royal Conservatory 90.0%. Run `npm run rtp` for the breakdown.

## Performance budgets (Quest 3 reference, Quest 2 supported)

Budget: 150 draws, 750k triangles. Quest 2 uses half-size textures, fewer chandelier crystals and glass
flowers, and no extra point lights. `?stats` shows fps, draws, triangles and how many meshes the culler
skipped this frame.

What keeps draws down:

- **Portal culling** (`cull.ts`, cells and doorways in `resortcull.ts`): the casino floor, poker room,
  hotel corridor, lobby, pool deck and every lift cab are cells joined by doorways. Each frame the culler
  walks from your eye's cell through the doorways it can see, narrowing a frustum at each, and only draws
  what is in your cell or inside one of those frusta. A closed lift cab shows only itself; the lobby sees the
  casino only down the corridor. Culled meshes go to layer 31 (no camera draws it; the interaction
  raycasters enable every layer, so things can still be pointed at). The crowd asks the same culler.
- **Tiny far detail**: a mesh whose bounding sphere is small for its distance (radius < 1% of it on Quest 3,
  1.5% through a doorway; never within 8 m) is skipped.
- **Crowd**: per-tier draw distance (Quest 3 20 m, Quest 2 18 m, phones 16 m) and nobody behind a wall
  (the culler's doorways again). Hidden people aren't posed either.
- **Merging**: `bakeStatic` per object; `byColor` for static decor (materials alike but for colour share
  a draw, colour per vertex); alike sprites batched into one camera-facing mesh (`batchSprites`); one lift
  batch per landing; flat or additive double-sided transparent meshes drawn in one pass, not two.
- **Idle when away**: the slot rows' screens and bulbs stop redrawing when the bank is far or out of view;
  the arcade idles off the Promenade; the piano's fingertips and synth only near the keys.

Measured (Playwright, headless Chromium/SwiftShader, 800×480, worst of 8 directions per spot; draws / triangles):

| Spot | Quest 3 before | Quest 3 after | Mobile before | Mobile after |
|---|---|---|---|---|
| Casino centre | 306 / 957k | 214 / 875k | 274 | 195 |
| Hotel lobby (looking down the corridor) | 421 / 760k | 187 / 601k | 419 | 188 |
| Casino lift cab, doors shut | 435 / 774k | 33 / 52k | 445 | 32 |
| Casino lift cab, doors open | 437 / 774k | 191 / 664k | 447 | 207 |
| Bar Lago (looking across the floor) | 419 / 967k | 288 / 901k | 394 | 267 |
| Craps / roulette / blackjack | 325 / 991k | 243 / 945k | 294 | 212 |
| Poker room (looking out the door) | 453 / 983k | 160 / 399k | 430 | 145 |
| Pool party | 176 / 242k | 121 / 237k | 131 | 103 |
| Suite | 59 / 43k | 53 / 42k | 61 | 52 |
| Promenade food court | 109 / 219k | 110 / 218k | 103 | 103 |
| Arcade | 108 / 200k | 104 / 179k | 93 | 93 |

Still over budget: views across the open casino floor (and down the corridor or through the poker room's door
into it), in draws and, with the crowd in view, triangles. The hall's props each carry a dozen or more
materials of their own (every slot machine's screens, glass, trim and bulbs; the tables' felts and racks), so
the next steps there are texture atlases per prop family, far-prop impostors and a lighter crowd LOD.
