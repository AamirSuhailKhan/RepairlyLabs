import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const expected = path.resolve(root, 'public');
const source = path.resolve(expected, 'dark-blue-only.css');
if (!fs.existsSync(source)) {
  console.error('BLOCKED: public/dark-blue-only.css is missing. Copy the patch into your project root first.');
  process.exit(2);
}
const files = ['public/index.html', 'public/part-request/index.html'];
const backups = path.resolve(root, '.repairly-color-backups');
let changed = 0;
let installed = 0;
let blocked = 0;

for (const relative of files) {
  const target = path.resolve(root, relative);
  if (!fs.existsSync(target)) {
    console.error(`BLOCKED: ${relative} does not exist; no edits to this file.`);
    blocked += 1;
    continue;
  }
  const original = fs.readFileSync(target, 'utf8');
  if (!original.includes('</head>')) {
    console.error(`BLOCKED: ${relative} has no </head>; no edits to this file.`);
    blocked += 1;
    continue;
  }
  // Older full cream palette was explicitly rejected: disable its link, not
  // any unrelated site stylesheet. Do not alter the old stylesheets themselves.
  let updated = original.replace(/^[ \t]*<link\b(?=[^>]*href=["'][^"']*cream-harmony\.css[^"']*["'])[^>]*>\s*\r?\n?/gmi, '');
  updated = updated.replace(/^[ \t]*<link\b(?=[^>]*href=["'][^"']*dark-blue-only\.css[^"']*["'])[^>]*>\s*\r?\n?/gmi, '');
  updated = updated.replace(/<\/head>/i, '  <link rel="stylesheet" href="/dark-blue-only.css?v=20261124-1" />\n</head>');
  if (updated === original) {
    console.log(`UNCHANGED ${relative} (already installed)`);
    installed += 1;
    continue;
  }
  fs.mkdirSync(backups, { recursive: true });
  const backup = path.join(backups, relative.replaceAll(/[\\/]/g, '__') + '.before-dark-blue-only.html');
  if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
  fs.writeFileSync(target, updated);
  changed += 1;
  console.log(`UPDATED ${relative}`);
}
if (blocked > 0) {
  console.error(`BLOCKED: ${blocked} required HTML file(s) were unavailable.`);
  process.exitCode = 2;
} else if (changed === 0 && installed === files.length) {
  console.log('DONE: already installed; no further HTML edits needed.');
} else {
  console.log(`DONE: ${changed} public HTML files updated. Original design retained; dark-blue backgrounds recolored.`);
  console.log('No backend, database, .env, logo or motion files were touched.');
}
