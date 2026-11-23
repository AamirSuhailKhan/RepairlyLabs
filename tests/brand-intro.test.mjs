import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('RepairlyBrandIntro Module & Integration Audit', () => {
  const indexHtml = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
  const introCss = fs.readFileSync(path.resolve('public/brand-intro.css'), 'utf8');
  const introJs = fs.readFileSync(path.resolve('public/brand-intro.js'), 'utf8');

  it('includes brand-intro.css stylesheet and brand-intro.js script in index.html', () => {
    assert.ok(indexHtml.includes('brand-intro.css'), 'Missing brand-intro.css link');
    assert.ok(indexHtml.includes('brand-intro.js'), 'Missing brand-intro.js script');
  });

  it('contains the #repairly-brand-intro container with dialog role and accessibility attributes', () => {
    assert.ok(indexHtml.includes('id="repairly-brand-intro"'), 'Missing #repairly-brand-intro container');
    assert.ok(indexHtml.includes('role="dialog"'), 'Missing role="dialog"');
    assert.ok(indexHtml.includes('aria-modal="true"'), 'Missing aria-modal="true"');
  });

  it('contains all 8 individual authentic petal layers and the center spiral void', () => {
    assert.ok(indexHtml.includes('intro-center-spiral'), 'Missing intro-center-spiral');
    for (let i = 1; i <= 8; i++) {
      const petalName = `petal-0${i}`;
      assert.ok(indexHtml.includes(petalName), `Missing ${petalName} layer in HTML`);
      assert.ok(fs.existsSync(path.resolve(`public/assets/brand/intro/${petalName}.png`)), `Missing PNG: ${petalName}.png`);
      assert.ok(fs.existsSync(path.resolve(`public/assets/brand/intro/${petalName}.webp`)), `Missing WebP: ${petalName}.webp`);
    }
    assert.ok(fs.existsSync(path.resolve('public/assets/brand/intro/center-spiral.png')), 'Missing center-spiral.png');
    assert.ok(fs.existsSync(path.resolve('public/assets/brand/intro/center-spiral.webp')), 'Missing center-spiral.webp');
  });

  it('contains an accessible skip button with proper aria-label', () => {
    assert.ok(indexHtml.includes('id="intro-skip-btn"'), 'Missing #intro-skip-btn');
    assert.ok(indexHtml.includes('aria-label="Skip introduction"'), 'Missing aria-label on skip button');
  });

  it('implements 5-stage CSS keyframe animations for all petals', () => {
    assert.ok(introCss.includes('intro-center-spin'), 'Missing center spiral spin animation');
    for (let i = 1; i <= 8; i++) {
      assert.ok(introCss.includes(`intro-petal-${i}`), `Missing CSS animation for petal ${i}`);
    }
  });

  it('includes accessibility prefers-reduced-motion media query in CSS and JS', () => {
    assert.ok(introCss.includes('(prefers-reduced-motion: reduce)'), 'Missing prefers-reduced-motion in CSS');
    assert.ok(introJs.includes('prefers-reduced-motion: reduce'), 'Missing prefers-reduced-motion in JS');
  });

  it('includes session-scoped storage check so intro plays once per session', () => {
    assert.ok(introJs.includes('sessionStorage.getItem'), 'Missing sessionStorage check');
    assert.ok(introJs.includes('sessionStorage.setItem'), 'Missing sessionStorage setter');
    assert.ok(introJs.includes('repairly_intro_seen'), 'Missing storage key');
  });

  it('supports developer query parameters (?intro=1, ?replay=1) and window.RepairlyBrandIntro.replay()', () => {
    assert.ok(introJs.includes("params.get('intro') === '1'"), 'Missing ?intro=1 check');
    assert.ok(introJs.includes("params.get('replay') === '1'"), 'Missing ?replay=1 check');
    assert.ok(introJs.includes('replay()'), 'Missing replay method');
  });

  it('has a 3500ms failsafe timer so user is never locked behind overlay', () => {
    assert.ok(introJs.includes('TIMEOUT_FAILSAFE = 3500'), 'Missing 3500ms failsafe constant');
    assert.ok(introJs.includes('this.failsafeTimer'), 'Missing failsafe timer implementation');
  });
});
