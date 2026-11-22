// Turns dist/index.html into a body fragment for publishing as a claude.ai Artifact
// (the host wraps the page in its own <html>/<head>/<body>).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="manifest"[^>]*>\s*/i, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync('dist/artifact.html', head.trim() + '\n' + body.trim() + '\n');
console.log('wrote dist/artifact.html');

// The artifact host doesn't serve .glb/.hdr; ship base64 copies the client falls back to.
for (const dir of ['dist/assets/people', 'dist/assets/tex']) {
  for (const f of readdirSync(dir)) {
    if (!/\.(glb|hdr)$/.test(f)) continue;
    writeFileSync(`${dir}/${f}.b64.json`, JSON.stringify(readFileSync(`${dir}/${f}`).toString('base64')));
    console.log('wrote', `${dir}/${f}.b64.json`);
  }
}
