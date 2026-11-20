# Palazzo Lago Casino

A VR-first luxury casino that also runs in any web browser. Built with TypeScript, Three.js and WebXR.
Play money only.

**Built so far (phases 0–2):** the casino hall, American roulette, and three slot machines
(Diamond Sevens, Lago Fortuna, Royal Conservatory). Craps is on the floor as "opening soon".

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
| Move | Bottom buttons, click the floor, WASD/arrows, drag to look | Point at floor + trigger to teleport, thumbstick snap-turn, wrist menu (left hand) |
| Roulette | Pick a chip (or keys 1–7), click the layout; Space spin, Z undo, C clear, R rebet | Point and trigger/pinch on chips, felt and buttons |
| Slots | − / + bet, SPIN (or click the screen), Info for paytable | Same, with the laser; pull the lever on Diamond Sevens |

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
  player.ts     desktop camera, VR teleport and snap turn
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
