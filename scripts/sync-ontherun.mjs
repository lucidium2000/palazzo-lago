// Copies "On the Run" (the owner's own WebGL racing game, published as a
// claude.ai artifact) into the arcade as a same-origin asset under
// public/arcade/ontherun/, with small, marked patches (scripts/ontherun-patch.mjs
// lists and checks them):
//
//   - the artifact viewer's wrapper is stripped (the game's document starts at
//     the inner <!doctype html>);
//   - a one-line hook lets the arcade cabinet drive the page from inside the
//     VR headset (its requestAnimationFrame, devicePixelRatio, audio and
//     controllers), and does nothing when the page is opened on its own;
//   - three.js (MIT) is vendored at the version the game's import map names,
//     with just the addons it imports, instead of cdn.jsdelivr.net;
//   - the Google Fonts (Chakra Petch, Russo One; SIL OFL 1.1) are vendored as
//     local woff2 files instead of fonts.googleapis.com;
//   - window.__otrGfx exposes the renderer / composer / bloom pass so the
//     cabinet can lower quality on light headsets.
// The game's sounds (snd/*.mp3) are copied byte for byte.
//
// Usage:
//   node scripts/sync-ontherun.mjs [path/to/game-folder] [--three <three package dir>] [--fonts <dir with the @fontsource packages>]
// The game folder holds index.html (as the artifact service returns it, wrapped
// or not) and snd/. Default: $ONTHERUN_SRC or ../ontherun-src next to this repo.
// three.js and the fonts are reused from the existing copy when the versions
// match; otherwise they are fetched with `npm pack` (registry.npmjs.org).
// Re-run it whenever the game is updated.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addonImports, patchGame, relativeImports, stripWrapper, threeVersion } from './ontherun-patch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const srcDir = resolve(positional[0] ?? process.env.ONTHERUN_SRC ?? join(root, '..', 'ontherun-src'));
const outDir = join(root, 'public', 'arcade', 'ontherun');
const fail = (msg) => {
  console.error(`sync-ontherun: ${msg}`);
  process.exit(1);
};

const srcFile = join(srcDir, 'index.html');
if (!existsSync(srcFile)) fail(`no ${srcFile} (pass the game's folder as the first argument)`);
const raw = readFileSync(srcFile, 'utf8');
const { html: game, stripped } = stripWrapper(raw);
const ver = threeVersion(game);
if (!ver) fail('the import map no longer names three from cdn.jsdelivr.net');
const VENDOR = `vendor/three-${ver}`;
const FONTS = 'fonts/fonts.css';

let patched;
try {
  patched = patchGame(game, { vendor: VENDOR, fonts: FONTS });
} catch (e) {
  fail(e.message);
}

// npm pack a package into a temp folder (only when there's no local copy to reuse).
const scratch = [];
function npmPack(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'otr-sync-'));
  scratch.push(dir);
  const file = execFileSync('npm', ['pack', spec, '--silent'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['xzf', file], { cwd: dir });
  return join(dir, 'package');
}

// --- three.js and the addons the game imports (with their own relative imports) ---
mkdirSync(outDir, { recursive: true });
const vendorDir = join(outDir, VENDOR);
const addons = addonImports(game);
const wantFiles = ['three.module.min.js', 'LICENSE', ...addons.map((a) => `addons/${a}`)];
const haveAll = wantFiles.every((f) => existsSync(join(vendorDir, f)));
let threeNote = `three ${ver} reused`;
if (!haveAll) {
  const pkg = opt('--three') ? resolve(opt('--three')) : npmPack(`three@${ver}`);
  const pv = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  if (pv !== ver) fail(`--three is three ${pv}, the game wants ${ver}`);
  // Older copies go (a new version gets its own folder).
  const vroot = join(outDir, 'vendor');
  if (existsSync(vroot)) for (const d of readdirSync(vroot)) if (d.startsWith('three-') && d !== `three-${ver}`) rmSync(join(vroot, d), { recursive: true });
  mkdirSync(vendorDir, { recursive: true });
  copyFileSync(join(pkg, 'build', 'three.module.min.js'), join(vendorDir, 'three.module.min.js'));
  copyFileSync(join(pkg, 'LICENSE'), join(vendorDir, 'LICENSE'));
  const seen = new Set();
  const queue = [...addons];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const from = join(pkg, 'examples', 'jsm', rel);
    if (!existsSync(from)) fail(`three ${ver} has no examples/jsm/${rel}`);
    const src = readFileSync(from, 'utf8');
    mkdirSync(dirname(join(vendorDir, 'addons', rel)), { recursive: true });
    writeFileSync(join(vendorDir, 'addons', rel), src);
    for (const r of relativeImports(src)) queue.push(join(dirname(rel), r).replace(/\\/g, '/'));
  }
  threeNote = `three ${ver} vendored (${seen.size} addon files)`;
}

// --- Fonts ---
const FONT_FILES = [
  ['@fontsource/chakra-petch', 'chakra-petch-latin-400-normal.woff2', 'Chakra Petch', 400],
  ['@fontsource/chakra-petch', 'chakra-petch-latin-600-normal.woff2', 'Chakra Petch', 600],
  ['@fontsource/chakra-petch', 'chakra-petch-latin-700-normal.woff2', 'Chakra Petch', 700],
  ['@fontsource/russo-one', 'russo-one-latin-400-normal.woff2', 'Russo One', 400],
];
const fontDir = join(outDir, 'fonts');
let fontNote = 'fonts reused';
if (!FONT_FILES.every(([, f]) => existsSync(join(fontDir, f))) || !existsSync(join(fontDir, 'OFL-ChakraPetch.txt'))) {
  mkdirSync(fontDir, { recursive: true });
  const pkgs = {};
  for (const [pkg] of FONT_FILES) {
    if (pkgs[pkg]) continue;
    const local = opt('--fonts') && join(resolve(opt('--fonts')), pkg.replace('@fontsource/', 'fontsource-'));
    pkgs[pkg] = local && existsSync(local) ? local : npmPack(pkg);
  }
  for (const [pkg, f] of FONT_FILES) copyFileSync(join(pkgs[pkg], 'files', f), join(fontDir, f));
  copyFileSync(join(pkgs['@fontsource/chakra-petch'], 'LICENSE'), join(fontDir, 'OFL-ChakraPetch.txt'));
  copyFileSync(join(pkgs['@fontsource/russo-one'], 'LICENSE'), join(fontDir, 'OFL-RussoOne.txt'));
  fontNote = 'fonts vendored';
}
const css = FONT_FILES.map(([, f, family, w]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(${f}) format('woff2')}`).join('\n');
writeFileSync(join(fontDir, 'fonts.css'), `/* palazzo-lago: Chakra Petch and Russo One (SIL OFL 1.1, see OFL-*.txt), latin subsets from @fontsource, vendored by scripts/sync-ontherun.mjs */\n${css}\n`);

// --- The sounds, byte for byte ---
const sndSrc = join(srcDir, 'snd');
const sndOut = join(outDir, 'snd');
const referenced = new Set([...game.matchAll(/snd\/([A-Za-z0-9_]+)\.mp3/g)].map((m) => m[1]));
for (const m of game.matchAll(/OTR_SND = Object\.fromEntries\(\[([^\]]*)\]/g)) for (const n of m[1].matchAll(/"([A-Za-z0-9_]+)"/g)) referenced.add(n[1]);
let nSnd = 0,
  bytes = 0;
const missing = [];
if (existsSync(sndSrc)) {
  mkdirSync(sndOut, { recursive: true });
  const have = new Set(readdirSync(sndSrc).filter((f) => f.endsWith('.mp3')));
  for (const f of have) {
    copyFileSync(join(sndSrc, f), join(sndOut, f));
    nSnd++;
    bytes += statSync(join(sndSrc, f)).size;
  }
  for (const r of referenced) if (!have.has(`${r}.mp3`)) missing.push(r);
  // Sounds the game no longer ships go.
  for (const f of readdirSync(sndOut)) if (!have.has(f)) rmSync(join(sndOut, f));
} else console.warn(`sync-ontherun: no ${sndSrc}: the game will run silent (its sounds are fetched from snd/)`);

writeFileSync(join(outDir, 'index.html'), patched.html);
for (const d of scratch) rmSync(d, { recursive: true, force: true });
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(
  `sync-ontherun: ${srcFile} -> public/arcade/ontherun/index.html (${mb(Buffer.byteLength(patched.html))}; ${stripped ? 'viewer wrapper stripped; ' : ''}patches: ${patched.done.join(', ')}; ${threeNote}; ${fontNote}; ${nSnd} sounds, ${mb(bytes)})`,
);
if (missing.length) console.warn(`sync-ontherun: sounds the page names but the source lacks (the game falls back to its synth or skips them): ${missing.join(', ')}`);
