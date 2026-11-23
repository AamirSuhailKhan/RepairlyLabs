/**
 * RepairlyLabs — Cinematic Prismatic Spiral Flower Opening & Website Reveal
 * 
 * Reusable motion module implementing the 5-stage authentic brand introduction:
 * - Stage A (0-450ms): Logo entrance & subtle scale
 * - Stage B (450-850ms): Logo recognition pause
 * - Stage C (850-1750ms): 8-petal logarithmic spiral separation
 * - Stage D (1400-2200ms): Seamless center reveal of underlying homepage hero
 * - Stage E (1900-2600ms): Hero CTA & navigation entrance, unmount overlay
 */
(function(window, document) {
  'use strict';

  const STORAGE_KEY = 'repairly_intro_seen';
  const TIMEOUT_FAILSAFE = 3500;

  class RepairlyBrandIntro {
    constructor() {
      this.el = null;
      this.skipBtn = null;
      this.timers = [];
      this.isDestroyed = false;
      this.hasPlayed = false;
      this.init();
    }

    shouldPlay() {
      // 1. Dev / test query parameter override (?intro=1 or ?replay=1)
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('intro') === '1' || params.get('replay') === '1') {
          return true;
        }
      } catch (e) {}

      // 2. Accessibility: prefers-reduced-motion bypasses animation
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
      }

      // 3. First-visit check per browser session
      try {
        if (sessionStorage.getItem(STORAGE_KEY) === 'true') {
          return false;
        }
      } catch (e) {
        // Fallback for private browsing with storage blocked: play once per page lifecycle
        return !this.hasPlayed;
      }

      return true;
    }

    init() {
      // Check if intro element exists or should be rendered
      this.el = document.getElementById('repairly-brand-intro');
      if (!this.el) return;

      this.skipBtn = document.getElementById('intro-skip-btn');

      if (!this.shouldPlay()) {
        this.destroyImmediate();
        return;
      }

      this.startIntro();
    }

    startIntro() {
      if (this.isDestroyed) return;

      // Lock body scroll
      document.documentElement.classList.add('intro-locked');
      document.body.classList.add('intro-locked', 'intro-active');

      // Bind Skip button
      if (this.skipBtn) {
        this.skipBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.skip();
        });
      }

      // Bind Escape key
      this.keyHandler = (e) => {
        if (e.key === 'Escape') {
          this.skip();
        }
      };
      window.addEventListener('keydown', this.keyHandler);

      // Failsafe timer: site is guaranteed never to stay locked
      this.failsafeTimer = setTimeout(() => {
        if (!this.isDestroyed) {
          this.skip();
        }
      }, TIMEOUT_FAILSAFE);

      // ----------------------------------------------------
      // Stage A (0 - 450ms): Entrance & scale
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.add('stage-enter');
        }
      }, 50);

      // ----------------------------------------------------
      // Stage B (450 - 850ms): Recognition pause
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.remove('stage-enter');
          this.el.classList.add('stage-recognized');
        }
      }, 450);

      // ----------------------------------------------------
      // Stage C (850 - 1750ms): 8-petal separation
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.add('stage-separating');
        }
      }, 850);

      // ----------------------------------------------------
      // Stage D (1400 - 2200ms): Website hero reveal
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.add('stage-revealing', 'intro-fading');
        }
        document.body.classList.add('intro-revealing');
      }, 1400);

      // ----------------------------------------------------
      // Stage E (2100 - 2500ms): Hero CTA focus & unmount
      // ----------------------------------------------------
      this.schedule(() => {
        this.finish();
      }, 2350);
    }

    schedule(fn, delay) {
      const t = setTimeout(fn, delay);
      this.timers.push(t);
      return t;
    }

    clearTimers() {
      if (this.failsafeTimer) {
        clearTimeout(this.failsafeTimer);
        this.failsafeTimer = null;
      }
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
    }

    skip() {
      this.finish();
    }

    finish() {
      if (this.isDestroyed) return;
      this.isDestroyed = true;
      this.hasPlayed = true;

      this.clearTimers();
      if (this.keyHandler) {
        window.removeEventListener('keydown', this.keyHandler);
        this.keyHandler = null;
      }

      // Mark session as seen
      try {
        sessionStorage.setItem(STORAGE_KEY, 'true');
      } catch (e) {}

      // Unlock body & reveal hero
      document.documentElement.classList.remove('intro-locked');
      document.body.classList.remove('intro-locked', 'intro-active');
      document.body.classList.add('intro-complete');

      if (this.el) {
        this.el.classList.add('intro-hidden');
        this.el.setAttribute('aria-hidden', 'true');
      }
    }

    destroyImmediate() {
      this.isDestroyed = true;
      this.clearTimers();
      document.documentElement.classList.remove('intro-locked');
      document.body.classList.remove('intro-locked', 'intro-active');
      document.body.classList.add('intro-complete');
      if (this.el) {
        this.el.classList.add('intro-hidden');
        this.el.setAttribute('aria-hidden', 'true');
      }
    }

    replay() {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
      this.isDestroyed = false;
      if (this.el) {
        this.el.className = 'repairly-brand-intro';
        this.el.removeAttribute('aria-hidden');
      }
      this.startIntro();
    }
  }

  // Auto-instantiate when DOM is ready
  function autoInit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.RepairlyBrandIntro = new RepairlyBrandIntro();
      });
    } else {
      window.RepairlyBrandIntro = new RepairlyBrandIntro();
    }
  }

  autoInit();
})(window, document);
