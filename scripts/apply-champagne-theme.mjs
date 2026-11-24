import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const expected = path.resolve(root, 'public');
const source = path.resolve(expected, 'champagne-harmony.css');
if (!fs.existsSync(source)) {
  console.error('BLOCKED: public/champagne-harmony.css is missing.');
  process.exit(2);
}
const files = ['public/index.html', 'public/part-request/index.html'];
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
  let updated = original.replace(/^[ \t]*<link\b(?=[^>]*href=["'][^"']*(?:cream-harmony|dark-blue-only|champagne-harmony)\.css[^"']*["'])[^>]*>\s*\r?\n?/gmi, '');
  updated = updated.replace(/<\/head>/i, '  <link rel="stylesheet" href="/champagne-harmony.css?v=20261124-champagne" />\n</head>');
  if (updated === original) {
    console.log(`UNCHANGED ${relative} (already installed)`);
    installed += 1;
    continue;
  }
  fs.writeFileSync(target, updated);
  changed += 1;
  console.log(`UPDATED ${relative}`);
}
if (blocked > 0) {
  console.error(`BLOCKED: ${blocked} required HTML file(s) were unavailable.`);
  process.exitCode = 2;
} else {
  console.log(`DONE: Warm Blush Champagne palette verified in ${files.length} public HTML portals.`);
}
