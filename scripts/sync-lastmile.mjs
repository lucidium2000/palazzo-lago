// Copies "The Last Mile" (Christopher G. Hunt's single-file browser game, MIT)
// into the arcade as a same-origin asset, with two small, marked patches:
//
//   1. A one-line hook at the top of <head>. When the page is loaded inside the
//      arcade's hidden iframe it hands its window to the cabinet *before the
//      game's own script runs*, so the cabinet can take over
//      requestAnimationFrame (browsers pause the page's rAF during an immersive
//      WebXR session), pin devicePixelRatio to 1 and route its AudioContext
//      into the room. Opened on its own (no parent, or a parent without the
//      hook) it does nothing at all.
//   2. The four embedded third-party audio clips (FREE_B64, WOAH_B64, KEN_B64,
//      RING_B64) are emptied. The game's README says they are not the author's
//      work and are not covered by the MIT grant, and that removing them is
//      safe (the samplers decode nothing and play nothing). Pass --keep-clips
//      to ship them anyway.
//
// Usage: node scripts/sync-lastmile.mjs [path/to/the-last-mile] [--keep-clips]
// Default source: ../lucidium2000/the-last-mile next to this repo, or $LASTMILE_SRC.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const keepClips = args.includes('--keep-clips');
const srcDir = resolve(args.find((a) => !a.startsWith('--')) ?? process.env.LASTMILE_SRC ?? join(root, '..', 'lucidium2000', 'the-last-mile'));
const outDir = join(root, 'public', 'arcade', 'lastmile');

const srcFile = join(srcDir, 'index.html');
if (!existsSync(srcFile)) {
  console.error(`sync-lastmile: no ${srcFile} (pass the game's folder as the first argument)`);
  process.exit(1);
}
let html = readFileSync(srcFile, 'utf8');

// What the cabinet relies on: fail loudly if the game has changed shape.
const needs = [
  [/requestAnimationFrame\(frame\)/, 'the frame loop is scheduled with requestAnimationFrame(frame)'],
  [/window\.AudioContext \|\| window\.webkitAudioContext/, 'audio comes from window.AudioContext'],
  [/window\.addEventListener\("keydown"/, 'keys are read from window keydown'],
  [/<canvas id="c">/, 'the game draws on <canvas id="c">'],
];
for (const [re, what] of needs) {
  if (!re.test(html)) {
    console.error(`sync-lastmile: the game no longer matches what the cabinet expects: ${what}`);
    process.exit(1);
  }
}

// 1. The hook (the first script on the page; the game's own comes later).
const MARK = '<!-- palazzo-lago: arcade cabinet hook (scripts/sync-lastmile.mjs) -->';
const HOOK = `${MARK}\n<script>try{var h=window.parent!==window&&window.parent.__lastMileHook;if(typeof h==="function")h(window)}catch(e){}</script>\n`;
if (html.includes(MARK)) {
  console.error('sync-lastmile: the source already carries the hook (sync from the game, not from this copy)');
  process.exit(1);
}
// Right after <meta charset> (which has to stay in the first 1 KB), else straight after <head>.
const at = /<meta charset[^>]*>\s*/i.test(html) ? /<meta charset[^>]*>\s*/i : /<head>\s*/i;
html = html.replace(at, (m) => `${m}${HOOK}`);
if (!html.includes(MARK)) {
  console.error('sync-lastmile: no <head> to put the hook in');
  process.exit(1);
}

// 2. The third-party clips.
let stripped = 0;
if (!keepClips) {
  html = html.replace(/^var (FREE|WOAH|KEN|RING)_B64 = "[A-Za-z0-9+/=]*";/gm, (_m, k) => {
    stripped++;
    return `var ${k}_B64 = ""; /* palazzo-lago: third-party clip removed (see the game's README, "License") */`;
  });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
if (existsSync(join(srcDir, 'LICENSE'))) copyFileSync(join(srcDir, 'LICENSE'), join(outDir, 'LICENSE'));
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`sync-lastmile: ${srcFile} -> public/arcade/lastmile/index.html (${kb(Buffer.byteLength(html))}; hook added; ${keepClips ? 'clips kept' : `${stripped} third-party clips removed`})`);
