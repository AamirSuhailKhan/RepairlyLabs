/* Must run in <head> before first paint. Compatible with script-src 'self'. */
if ((location.pathname === '/' || location.pathname === '/index.html') &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('rl-intro-armed');
}
