import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const controller = src.slice(src.indexOf('const heroJourneySteps='), src.indexOf('function serviceCard'));
function harness(reduced = false) {
    let now = 0, id = 0, frame = null, visibleCB, disconnected = false, keyboard = false;
    const make = () => ({ innerHTML: '', textContent: '', style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, classList: { toggle() { } }, setAttribute(k, v) { this.attrs[k] = v; }, toggleAttribute(k, v) { if (v) this.attrs[k] = ''; else delete this.attrs[k]; }, addEventListener(k, f) { this.listeners[k] = f; }, emit(k, e = {}) { this.listeners[k]?.(e); }, querySelector() { return this.badge ??= make(); }, animate() { return { cancel() { } }; } });
    const ids = Object.fromEntries('icon title index dynamic eyebrow heading desc cta'.split(' ').map(n => ['hero-step-' + n, make()])); for (const n of ['hero-footer-text', 'hero-secondary-cta', 'hero-note-text', 'hero-progress-bar', 'hero-play-toggle', 'hero-step-announcement']) ids[n] = make();
    const card = make(), rows = Array.from({ length: 3 }, (_, i) => { const n = make(); n.dataset.heroStep = String(i); return n; });
    const wrap = Object.assign(make(), { isConnected: true, querySelector(s) { return s === '.hero-process-card' ? card : s === ':focus-visible' ? (keyboard ? {} : null) : ids[s.slice(1)]; }, querySelectorAll() { return rows; } });
    const doc = Object.assign(make(), { hidden: false, documentElement: { classList: { contains: () => false } }, getElementById: () => wrap });
    const motion = Object.assign(make(), { matches: reduced });
    const ctx = vm.createContext({ document: doc, window: { matchMedia: () => motion, IntersectionObserver: 1 }, IntersectionObserver: class { constructor(cb) { visibleCB = cb; } observe() { visibleCB([{ isIntersecting: true, intersectionRatio: 1 }]); } disconnect() { disconnected = true; } }, AbortController, performance: { now: () => now }, requestAnimationFrame: cb => { frame = cb; return ++id; }, cancelAnimationFrame: () => { frame = null; }, icon: n => n, esc: v => String(v) });
    vm.runInContext(controller + ';bindHeroJourney();', ctx);
    const advance = ms => { for (let t = 0; t < ms; t += 50) { now += 50; const cb = frame; frame = null; cb?.(now); } };
    return { ids, rows, wrap, doc, motion, advance, setKeyboard: v => keyboard = v, leave: () => vm.runInContext('disposeHeroJourney()', ctx), stopped: () => disconnected && !frame };
}
const idx = h => h.ids['hero-step-index'].textContent;
const progress = h => h.ids['hero-progress-bar'].style.transform;
test('hero journey cycles through services automatically one by one without manual pause', () => {
    const h = harness(); assert.equal(idx(h), '01 / 03'); h.advance(850); assert.equal(idx(h), '02 / 03'); assert.equal(h.ids['hero-step-cta'].href, '/part-request/'); h.advance(850); assert.equal(idx(h), '03 / 03'); assert.equal(h.ids['hero-step-cta'].href, '/track'); assert.equal(h.ids['hero-secondary-cta'].href, '/part-request/#status-check'); assert.equal(h.ids['hero-secondary-cta'].hidden, false); h.advance(850); assert.equal(idx(h), '01 / 03'); assert.equal(h.ids['hero-step-cta'].href, '/repairs#booking'); assert.equal(h.ids['hero-secondary-cta'].hidden, true);
    h.doc.hidden = true; const hidden = progress(h); h.advance(5000); assert.equal(progress(h), hidden); h.doc.hidden = false;
    h.rows[2].emit('click'); assert.equal(idx(h), '03 / 03'); h.advance(850); assert.equal(idx(h), '01 / 03'); h.leave(); assert.ok(h.stopped());
});
