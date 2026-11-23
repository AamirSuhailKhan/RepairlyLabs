/**
 * RepairlyLabs — safe, idempotent warm-theme installer.
 * Run from the PROJECT ROOT (the folder containing public/index.html).
 * Only adds stylesheet references and updates public-page theme-color metadata.
 * Does not touch data/, .env, JavaScript application logic or customer records.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const pages = [
  {file:'public/index.html',href:'/cream-harmony.css?v=20261123-1'},
  {file:'public/part-request/index.html',href:'/part-request/cream-harmony.css?v=20261123-1'}
];
for (const {file} of pages) {
  if (!existsSync(join(root,file))) {
    console.error(`BLOCKED: Cannot locate ${file}. Run from the actual RepairlyLabs root.`);
    process.exit(2);
  }
}
if (!existsSync(join(root,'public/cream-harmony.css')) || !existsSync(join(root,'public/part-request/cream-harmony.css'))) {
  console.error('BLOCKED: Missing CSS patch files; merge the entire patch before running.');
  process.exit(2);
}
const backupDir=join(root,'.repairly-theme-backups');
mkdirSync(backupDir,{recursive:true});
const tag = new Date().toISOString().replace(/[:.]/g,'-');
for (const {file,href} of pages) {
  const path=join(root,file);
  const original=readFileSync(path,'utf8');
  if (!/<\/head\s*>/i.test(original)) {
    console.error(`BLOCKED: Cannot find </head> in ${file}. No change made to this file.`);
    process.exitCode=2;
    continue;
  }
  let updated = original;
  const re = /\s*<link\s+[^>]*href=["'](?:\/)?(?:part-request\/)?cream-harmony\.css(?:\?[^"']*)?["'][^>]*>/gi;
  updated=updated.replace(re,'');
  const link=`\n  <link rel="stylesheet" href="${href}" data-rl-cream-theme="1">\n`;
  updated=updated.replace(/<\/head\s*>/i,`${link}</head>`);
  updated=updated.replace(/(<meta\s+name=["']theme-color["']\s+content=["'])#[a-fA-F0-9]{3,8}(["'])/i,'$1#fffaf4$2');
  if (updated !== original) {
    const backupFile=join(backupDir,file.replaceAll('/','__')+'.'+tag+'.bak');
    copyFileSync(path,backupFile);
    writeFileSync(path,updated,'utf8');
    console.log(`UPDATED: ${file}; HTML backup stored in .repairly-theme-backups/`);
  } else console.log(`UNCHANGED: ${file}`);
}
console.log('No database, credentials, or application JavaScript were modified.');
