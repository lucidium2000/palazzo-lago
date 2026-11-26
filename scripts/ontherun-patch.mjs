// The text patches scripts/sync-ontherun.mjs applies to "On the Run" (pure
// functions, no file system, so tests/ontherun.test.ts runs them too).
//
// Every patch is small, marked in the output with "palazzo-lago", and checked:
// if the game changes shape so a patch no longer applies, the sync fails
// loudly instead of shipping a copy the cabinet can't drive.
//
//   1. stripWrapper: the claude.ai artifact service hands the page back
//      wrapped in its viewer's own <!doctype html><html><head>…<body>. The
//      game's document starts at the second <!doctype html>.
//   2. The cabinet hook: the first script on the page hands its window to the
//      arcade (window.parent.__onTheRunHook) before the game's own scripts run,
//      so the cabinet can replace requestAnimationFrame, pin devicePixelRatio,
//      route audio and provide the virtual controllers. Opened on its own the
//      hook does nothing.
//   3. three.js comes from the game's import map on cdn.jsdelivr.net; it is
//      vendored next to the page (same version, MIT) and the map points there.
//   4. Google Fonts (Chakra Petch, Russo One; SIL OFL 1.1) are vendored as
//      local woff2 files with a local stylesheet; the preconnects go.
//   5. One line after the post-processing chain is built exposes the renderer,
//      composer and bloom pass as window.__otrGfx, so the cabinet can lower
//      quality on light headsets (shadows, bloom, MSAA). Nothing else in the
//      game changes.

export const MARK = 'palazzo-lago';
export const HOOK_NAME = '__onTheRunHook';

/** The game's own document out of the artifact viewer's wrapper (unchanged if there is no wrapper). */
export function stripWrapper(html) {
  const re = /<!doctype html>/gi;
  const first = re.exec(html);
  const second = first ? re.exec(html) : null;
  if (!first || !second) return { html, stripped: false };
  let inner = html.slice(second.index);
  // The wrapper's closing tags (the game's document ends with its own </body></html> or none at all).
  const outerClose = /<\/body>\s*<\/html>\s*$/i;
  const innerOpensBody = /<body[\s>]/i.test(inner);
  if (!innerOpensBody) inner = inner.replace(outerClose, '\n');
  return { html: inner.trimStart(), stripped: true };
}

/** The three.js version the import map asks for (e.g. "0.160.0"), or null. */
export function threeVersion(html) {
  const m = /"three"\s*:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/three@([0-9.]+)\/build\/three\.module(?:\.min)?\.js"/.exec(html);
  return m ? m[1] : null;
}

/** The three.js addons the game imports ("postprocessing/EffectComposer.js", ...). */
export function addonImports(html) {
  const out = new Set();
  for (const m of html.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) out.add(m[1]);
  return [...out].sort();
}

/** Relative imports of one addon file (to vendor what it needs too). */
export function relativeImports(src) {
  const out = [];
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

const NEEDS = [
  [/<meta charset="utf-8">/i, 'the page starts with <meta charset="utf-8">'],
  [/<script type="importmap">/, 'three.js is loaded through an import map'],
  [/function frame\(now\) \{\s*requestAnimationFrame\(frame\);/, 'the main loop is scheduled with requestAnimationFrame(frame)'],
  [/window\.AudioContext \|\| window\.webkitAudioContext/, 'audio comes from window.AudioContext'],
  [/addEventListener\('keydown'/, 'keys are read from keydown on the window'],
  [/navigator\.getGamepads/, 'controllers are read with navigator.getGamepads'],
  [/\$\('stage'\)\.appendChild\(renderer\.domElement\)/, 'the WebGL canvas goes into #stage'],
];

/**
 * Applies patches 2-5 to the game's document. `vendor` is the folder of the
 * vendored three.js (relative to the page), `fonts` the local font stylesheet.
 * Returns the patched page and what was done; throws when the game no longer
 * matches what the cabinet relies on.
 */
export function patchGame(html, { vendor, fonts }) {
  for (const [re, what] of NEEDS) if (!re.test(html)) throw new Error(`the game no longer matches what the cabinet expects: ${what}`);
  if (html.includes(`${MARK}: arcade cabinet hook`)) throw new Error('the source already carries the cabinet hook (sync from the game, not from this copy)');
  const done = [];

  // 2. The hook, straight after <meta charset> (which has to stay in the first 1 KB).
  const HOOK = `<!-- ${MARK}: arcade cabinet hook (scripts/sync-ontherun.mjs) -->\n<script>try{var h=window.parent!==window&&window.parent.${HOOK_NAME};if(typeof h==="function")h(window)}catch(e){}</script>\n`;
  html = html.replace(/<meta charset="utf-8">/i, (m) => `${m}\n${HOOK}`);
  done.push('hook');

  // 3. three.js from the vendored copy.
  let n = 0;
  html = html.replace(/"three"\s*:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/three@[0-9.]+\/build\/three\.module(?:\.min)?\.js"/, () => {
    n++;
    return `"three": "./${vendor}/three.module.min.js"`;
  });
  html = html.replace(/"three\/addons\/"\s*:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/three@[0-9.]+\/examples\/jsm\/"/, () => {
    n++;
    return `"three/addons/": "./${vendor}/addons/"`;
  });
  if (n !== 2) throw new Error('the import map no longer has the three / three/addons entries on cdn.jsdelivr.net');
  html = html.replace(/<script type="importmap">/, `<!-- ${MARK}: three.js vendored next to the page (was a CDN) -->\n<script type="importmap">`);
  done.push('three');

  // 4. Fonts: the Google Fonts stylesheet becomes the local one; the preconnects go.
  let fontsDone = false;
  html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*/g, '');
  html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/, () => {
    fontsDone = true;
    return `<!-- ${MARK}: fonts vendored (were Google Fonts) --><link href="./${fonts}" rel="stylesheet">`;
  });
  if (fontsDone) done.push('fonts');
  const cdn = /.{0,60}(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net).{0,60}/.exec(html);
  if (cdn) throw new Error(`the page still loads something from a CDN: ${cdn[0]}`);

  // 5. The renderer, composer and bloom for the cabinet's quality settings.
  let gfx = false;
  html = html.replace(/composer\.addPass\(gradePass\);\n/, (m) => {
    gfx = true;
    return `${m}window.__otrGfx = { renderer, composer, bloom, gradePass, scene };   // ${MARK}: the arcade cabinet's quality settings\n`;
  });
  if (!gfx) throw new Error('no composer.addPass(gradePass); to expose the renderer after');
  done.push('gfx');
  return { html, done };
}
