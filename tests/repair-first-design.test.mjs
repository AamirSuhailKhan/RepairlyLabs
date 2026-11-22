import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/premium.css', import.meta.url), 'utf8');
const head = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('desktop and mobile navigation prioritize repair enquiries', () => {
  assert.match(app, /href="\/repairs#booking" class="btn btn-primary btn-sm nav-book" data-link>Request a Repair/);
  assert.match(app, /href="\/repairs#booking" data-link class="btn btn-primary nav-mobile-cta">Request a Repair/);
  assert.match(app, /\['\/repairs','Repairs'\],\['\/parts','Find a part'\]/);
});

test('home hero and footer have repair CTA before secondary parts enquiry', () => {
  const hero = app.slice(app.indexOf('function home()'), app.indexOf('function faqBlock()'));
  assert.ok(hero.indexOf('href="/repairs#booking" data-link>Request a Repair') >= 0);
  assert.ok(hero.indexOf('href="/repairs#booking" data-link>Request a Repair') < hero.indexOf('href="/part-request/">Find a mobile part'));
  assert.ok(hero.indexOf('section belief') < hero.indexOf('section india-parts-section'));
  const footer = app.slice(app.indexOf('function footer()'), app.indexOf('function frame('));
  assert.ok(footer.indexOf('href="/repairs#booking"') < footer.indexOf('href="/part-request/"'));
});

test('repair service cards use the same normal background, without position-based dark exceptions', () => {
  assert.match(css, /\.service-card,\.service-card\.compact\{[^}]*background:#fff;color:#102637/);
  assert.doesNotMatch(css, /\.service-card:nth-child\(1\)[^\n]*background:/);
  assert.doesNotMatch(css, /\.service-card:nth-child\(6\)[^\n]*background:/);
});

test('metadata and repair payment copy are consistent with quotation workflow', () => {
  assert.match(head, /RepairlyLabs makes it easier to request a mobile repair/);
  assert.match(app, /Submitting a repair enquiry is free/);
  assert.doesNotMatch(app, /We do not collect payment through this website/);
});
