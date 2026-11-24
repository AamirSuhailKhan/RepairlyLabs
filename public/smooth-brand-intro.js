/* RepairlyLabs — safe, tear-free cinematic intro.
   The approved source is flattened artwork: true, identical individual petals
   cannot be recovered from its occluded pixels. We use complete vector petals
   for a smooth visual transition, never chopped wedges of a bitmap.
*/
(() => {
  'use strict';
  const overlay = document.getElementById('rl-brand-intro');
  if (!overlay) return;
  const html = document.documentElement;
  const home = location.pathname === '/' || location.pathname === '/index.html';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!home || reduced) { overlay.remove(); html.classList.remove('rl-intro-armed'); return; }
  const logo = overlay.querySelector('.rl-brand-intro__image');
  const petals = overlay.querySelector('.rl-brand-intro__petals');
  const name = overlay.querySelector('.rl-brand-intro__name');
  const skip = overlay.querySelector('.rl-brand-intro__skip');
  const colors = [
    ['#fe9659', '#e2673b'], // 0: Tangerine / warm orange (0 deg)
    ['#c95852', '#983635'], // 1: Terracotta / rosewood (45 deg)
    ['#aa433c', '#742626'], // 2: Deep burgundy (90 deg)
    ['#c95a49', '#aa433c'], // 3: Crimson / rust (135 deg)
    ['#de6546', '#e8734e'], // 4: Coral red (180 deg)
    ['#fc8a32', '#f37f32'], // 5: Sunset orange (225 deg)
    ['#febe5a', '#fea53f'], // 6: Golden amber (270 deg)
    ['#fdd381', '#fdcd78']  // 7: Warm apricot honey (315 deg)
  ];
  // A complete closed Bézier silhouette per petal; no clip-path/sliced image.
  const petalPath = 'M100 109 C82 97 64 80 64 58 C64 36 81 21 102 20 C123 19 138 32 139 53 C140 76 116 99 100 109 Z';
  petals.innerHTML = colors.map((pair, i) => `
    <div class="rl-brand-intro__petal" data-petal="${i}" style="transform:rotate(${i*45}deg)">
      <svg viewBox="0 0 200 200" focusable="false" aria-hidden="true">
        <defs><linearGradient id="rlpetalg${i}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop stop-color="${pair[0]}" offset="0"/><stop stop-color="${pair[1]}" offset="1"/>
        </linearGradient></defs>
        <path d="${petalPath}" fill="url(#rlpetalg${i})"/>
      </svg>
    </div>`).join('');
  const layers = [...petals.querySelectorAll('.rl-brand-intro__petal')];
  let completed = false;
  let release;
  const onKey = (e) => { if (e.key === 'Escape') finish(); };
  const finish = () => {
    if (completed) return;
    completed = true;
    if (release) clearTimeout(release);
    window.removeEventListener('keydown', onKey);
    overlay.getAnimations().forEach(a => a.cancel());
    layers.forEach(el => el.getAnimations().forEach(a => a.cancel()));
    logo.getAnimations().forEach(a => a.cancel());
    name.getAnimations().forEach(a => a.cancel());
    petals.getAnimations().forEach(a => a.cancel());
    overlay.remove();
    html.classList.remove('rl-intro-armed');
    document.dispatchEvent(new CustomEvent('repairly:intro-end'));
  };
  skip.addEventListener('click', finish, {once:true});
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', finish, {once:true});
  release = setTimeout(finish, 4050); // fail open under any partial failure
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function play(el, frames, options) {
    if (completed) return Promise.resolve();
    if (!el.animate) { finish(); return Promise.resolve(); }
    const animation = el.animate(frames, {fill:'forwards', easing:'cubic-bezier(.22,.8,.22,1)', ...options});
    return animation.finished.catch(()=>{});
  }
  async function run() {
    // Image load failure is safe: site becomes available, no blank overlay.
    try { await Promise.race([logo.decode(), sleep(600)]); } catch { finish(); return; }
    if (completed) return;
    // Phase 1: authentic, complete, unmodified logo is visible first.
    await Promise.all([
      play(logo, [{opacity:0,transform:'scale(.91)'},{opacity:1,transform:'scale(1)'}], {duration:410}),
      play(name, [{opacity:0,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0px)'}], {duration:430,delay:110})
    ]);
    if (completed) return;
    await sleep(330);
    if (completed) return;
    // Phase 2+3: complete vector leaves depart from behind the original bitmap.
    // Crucially, the original logo never becomes a visibly torn/masked image.
    petals.style.opacity = '1';
    const travel = Math.max(innerWidth,innerHeight)*.68;
    const trips = layers.map((p, i) => {
      const angle = i*45;
      const radians = (angle-90) * Math.PI / 180;
      const dx = Math.cos(radians)*travel;
      const dy = Math.sin(radians)*travel;
      return play(p,[
        {offset:0, transform:`translate3d(0px,0px,0px) rotate(${angle}deg) scale(1)`,opacity:0},
        {offset:.17,transform:`translate3d(${dx*.07}px,${dy*.07}px,0px) rotate(${angle+2}deg) scale(1.02)`,opacity:1},
        {offset:.45,transform:`translate3d(${dx*.28}px,${dy*.28}px,0px) rotate(${angle+7}deg) scale(1.06)`,opacity:1},
        {offset:1,transform:`translate3d(${dx}px,${dy}px,0px) rotate(${angle+13}deg) scale(.9)`,opacity:0}
      ],{duration:1130,delay:i*26,easing:'cubic-bezier(.19,.74,.24,1)' });
    });
    // The original intact emblem leaves smoothly while the vector leaves move.
    const originalLeaves = play(logo,[
      {offset:0,opacity:1,transform:'scale(1)'},
      {offset:.38,opacity:1,transform:'scale(1.025)'},
      {offset:1,opacity:0,transform:'scale(.91)'}
    ],{duration:680,easing:'ease-in-out'});
    // Screen reveal is synchronized with the outward motion.
    const curtain = play(overlay,[
      {offset:0,opacity:1},{offset:.28,opacity:1},{offset:1,opacity:0}
    ],{duration:1250,delay:90,easing:'ease-in-out'});
    await Promise.all([...trips,originalLeaves,curtain]);
    finish();
  }
  run().catch(finish);
})();
