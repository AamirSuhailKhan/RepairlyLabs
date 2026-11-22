import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);

console.log(`Checking ${files.length} tracked files for secrets...`);

const secretPattern = /(?:password|passwd|secret|api_key|token)\s*[:=]\s*['"][^'"]{6,}['"]/i;

for (const f of files) {
  if (f.startsWith('test-results/')) continue;
  try {
    const content = readFileSync(f, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (secretPattern.test(line)) {
        console.log(`[ALERT] ${f}:${i + 1}: ${line.trim()}`);
      }
    });
  } catch {}
}
console.log('Sanitization check complete.');
