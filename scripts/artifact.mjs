// Turns dist/index.html into a body fragment for publishing as a claude.ai Artifact
// (the host wraps the page in its own <html>/<head>/<body>).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="manifest"[^>]*>\s*/i, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync('dist/artifact.html', head.trim() + '\n' + body.trim() + '\n');
console.log('wrote dist/artifact.html');
