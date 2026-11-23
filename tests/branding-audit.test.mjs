import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BRAND_DIR = path.join(ROOT, 'public', 'assets', 'brand');

const EXPECTED_BRAND_FILES = [
  'repairlylabs-logo-original.webp',
  'repairlylabs-logo-transparent.png',
  'repairlylabs-logo-transparent.webp',
  'repairlylabs-logo-512.png',
  'repairlylabs-logo-256.png',
  'repairlylabs-logo-192.png',
  'repairlylabs-logo-128.png',
  'repairlylabs-logo-64.png',
  'repairlylabs-favicon-32.png',
  'repairlylabs-favicon-16.png',
  'favicon.ico',
  'apple-touch-icon.png',
  'repairlylabs-og.png',
  'repairlylabs-logo.svg'
];

test('brand assets: all required official assets exist with non-zero size', () => {
  for (const filename of EXPECTED_BRAND_FILES) {
    const filePath = path.join(BRAND_DIR, filename);
    assert.ok(fs.existsSync(filePath), `Brand asset missing: ${filename}`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 0, `Brand asset empty: ${filename}`);
  }
});

test('brand assets: root favicons and social card shortcuts exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'favicon.ico')), 'public/favicon.ico missing');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'apple-touch-icon.png')), 'public/apple-touch-icon.png missing');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'repairlylabs-og.png')), 'public/repairlylabs-og.png missing');
});

test('branding audit: zero occurrences of obsolete company logo SVG in public and src', () => {
  // Path snippet of old wrench/phone logo:
  const oldSvgPattern = 'M22 2.5a4.2 4.2 0 0 1-5.5 5.5l-5 5';
  const oldStarburstIcon = 'brand-icon">✳</span>';

  const checkDirs = [path.join(ROOT, 'public'), path.join(ROOT, 'src')];
  const violations = [];

  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'test-results', '.git'].includes(entry.name)) {
          scan(fullPath);
        }
      } else if (/\.(html|js|mjs|css|svg)$/.test(entry.name)) {
        const text = fs.readFileSync(fullPath, 'utf-8');
        if (text.includes(oldSvgPattern)) {
          violations.push(`Old logo SVG found in: ${fullPath}`);
        }
        if (text.includes(oldStarburstIcon)) {
          violations.push(`Old starburst icon found in: ${fullPath}`);
        }
      }
    }
  }

  for (const d of checkDirs) {
    scan(d);
  }

  assert.deepEqual(violations, [], `Discovered obsolete company logo references:\n${violations.join('\n')}`);
});

test('branding audit: all 6 public HTML portals link to approved brand assets and modern favicons', () => {
  const portals = [
    'public/index.html',
    'public/repair-center/index.html',
    'public/parts-payment/index.html',
    'public/operations/index.html',
    'public/account-recovery/index.html',
    'public/part-request/index.html'
  ];

  for (const rel of portals) {
    const full = path.join(ROOT, rel);
    const html = fs.readFileSync(full, 'utf-8');
    assert.ok(
      html.includes('repairlylabs-favicon-32.png') || html.includes('repairlylabs-logo.svg'),
      `${rel} does not link to approved favicon`
    );
    assert.ok(
      html.includes('repairlylabs-logo-128.png') || html.includes('brand-flower-emblem'),
      `${rel} does not include new flower emblem mark`
    );
  }
});

test('manifest audit: webmanifest references new brand assets with proper purpose', () => {
  const manifestPath = path.join(ROOT, 'public', 'manifest.webmanifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.ok(Array.isArray(manifest.icons), 'Manifest must contain icons array');
  
  const iconSrcs = manifest.icons.map(i => i.src);
  assert.ok(iconSrcs.includes('/assets/brand/repairlylabs-logo-192.png'), 'Missing 192px icon');
  assert.ok(iconSrcs.includes('/assets/brand/repairlylabs-logo-512.png'), 'Missing 512px icon');
  assert.ok(iconSrcs.includes('/assets/brand/repairlylabs-logo.svg'), 'Missing SVG icon');
});
