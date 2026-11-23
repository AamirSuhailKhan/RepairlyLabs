import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('RepairlyLabs Tear-Free Brand Intro Audit', () => {
  const indexHtml = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
  const introCss = fs.readFileSync(path.resolve('public/smooth-brand-intro.css'), 'utf8');
  const introBootJs = fs.readFileSync(path.resolve('public/smooth-brand-intro-boot.js'), 'utf8');
  const introJs = fs.readFileSync(path.resolve('public/smooth-brand-intro.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');

  it('includes smooth-brand-intro.css, smooth-brand-intro-boot.js and smooth-brand-intro.js', () => {
    assert.ok(indexHtml.includes('smooth-brand-intro.css'), 'Missing smooth-brand-intro.css link');
    assert.ok(indexHtml.includes('smooth-brand-intro-boot.js'), 'Missing smooth-brand-intro-boot.js script in head');
    assert.ok(indexHtml.includes('smooth-brand-intro.js'), 'Missing smooth-brand-intro.js script before body end');
  });

  it('contains the #rl-brand-intro container with all required structure', () => {
    assert.ok(indexHtml.includes('id="rl-brand-intro"'), 'Missing #rl-brand-intro container');
    assert.ok(indexHtml.includes('rl-brand-intro__image'), 'Missing logo image element');
    assert.ok(indexHtml.includes('rl-brand-intro__petals'), 'Missing petals container element');
    assert.ok(indexHtml.includes('rl-brand-intro__name'), 'Missing brand name element');
    assert.ok(indexHtml.includes('rl-brand-intro__skip'), 'Missing skip button element');
  });

  it('contains official intact prismatic spiral brand assets', () => {
    assert.ok(fs.existsSync(path.resolve('public/assets/brand/prismatic-spiral-transparent.webp')), 'Missing prismatic-spiral-transparent.webp');
    assert.ok(fs.existsSync(path.resolve('public/assets/brand/prismatic-spiral-transparent.png')), 'Missing prismatic-spiral-transparent.png');
  });

  it('boots synchronously in <head> for zero-FOUC and CSP script-src self compatibility', () => {
    assert.ok(introBootJs.includes('rl-intro-armed'), 'Missing rl-intro-armed class arming');
    assert.ok(introCss.includes('html.rl-intro-armed .rl-brand-intro'), 'Missing armed display rule');
  });

  it('replays on every open and refresh without sessionStorage blocking', () => {
    assert.ok(!introJs.includes('sessionStorage'), 'sessionStorage should not be used for suppression');
    assert.ok(!introBootJs.includes('sessionStorage'), 'sessionStorage should not be used in boot script');
  });

  it('includes accessibility prefers-reduced-motion in CSS, boot JS, and main JS', () => {
    assert.ok(/prefers-reduced-motion\s*:\s*reduce/i.test(introCss), 'Missing prefers-reduced-motion in CSS');
    assert.ok(introBootJs.includes('(prefers-reduced-motion: reduce)'), 'Missing prefers-reduced-motion in boot JS');
    assert.ok(introJs.includes('(prefers-reduced-motion: reduce)'), 'Missing prefers-reduced-motion in main JS');
  });

  it('has both CSS and JS failsafe timeouts so the website is never locked', () => {
    assert.ok(introCss.includes('rl-intro-failsafe'), 'Missing CSS failsafe animation');
    assert.ok(introJs.includes('release = setTimeout'), 'Missing JS failsafe release timeout');
  });

  it('harmonizes global CSS design tokens with authentic logo palette', () => {
    assert.ok(stylesCss.includes('--brand-coral:#fb3848'), 'Missing --brand-coral token');
    assert.ok(stylesCss.includes('--brand-orange:#f8680f'), 'Missing --brand-orange token');
    assert.ok(stylesCss.includes('--brand-purple:#610981'), 'Missing --brand-purple token');
    assert.ok(stylesCss.includes('--brand-blue:#8a3ffb'), 'Missing --brand-blue token');
    assert.ok(stylesCss.includes('--brand-cyan:#14a8e4'), 'Missing --brand-cyan token');
    assert.ok(stylesCss.includes('--brand-emerald:#37ba92'), 'Missing --brand-emerald token');
  });
});
