/**
 * RepairlyLabs — Cinematic Prismatic Spiral Flower Opening & Website Reveal
 * 
 * Replay on every page load & refresh.
 * 5-Stage Seamless Brand Experience:
 * - Stage 1 (0-450ms): Pristine logo entrance & scale
 * - Stage 2 (450-900ms): Logo recognition pause
 * - Stage 3 (900-1900ms): 8 complete, seamless petals separate along outward spiral paths
 * - Stage 4 (1500-2400ms): Central portal reveals the underlying homepage hero
 * - Stage 5 (2400-2800ms): Hero CTA & navigation ready, overlay unmounts
 */
(function(window, document) {
  'use strict';

  const TIMEOUT_FAILSAFE = 3200;

  class RepairlyBrandIntro {
    constructor() {
      this.el = null;
      this.skipBtn = null;
      this.timers = [];
      this.isDestroyed = false;
      this.init();
    }

    shouldPlay() {
      // 1. Accessibility: prefers-reduced-motion bypasses animation
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
      }

      // 2. Plays on every fresh open and refresh (no sessionStorage blockage)
      return true;
    }

    init() {
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

      // Lock body scroll during cinematic intro
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
      // Stage 1 (0 - 450ms): Entrance & scale
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.add('stage-enter');
        }
      }, 40);

      // ----------------------------------------------------
      // Stage 2 (450 - 900ms): Logo recognition pause
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.remove('stage-enter');
          this.el.classList.add('stage-recognized');
        }
      }, 450);

      // ----------------------------------------------------
      // Stage 3 (900 - 1900ms): 8-petal spiral separation
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.remove('stage-recognized');
          this.el.classList.add('stage-separating');
        }
      }, 900);

      // ----------------------------------------------------
      // Stage 4 (1500 - 2400ms): Website hero reveal
      // ----------------------------------------------------
      this.schedule(() => {
        if (this.el) {
          this.el.classList.add('stage-revealing', 'intro-fading');
        }
        document.body.classList.add('intro-revealing');
      }, 1500);

      // ----------------------------------------------------
      // Stage 5 (2400 - 2800ms): Hero CTA focus & unmount
      // ----------------------------------------------------
      this.schedule(() => {
        this.finish();
      }, 2500);
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

      this.clearTimers();
      if (this.keyHandler) {
        window.removeEventListener('keydown', this.keyHandler);
        this.keyHandler = null;
      }

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
