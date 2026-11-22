/* Nonessential, progressive-enhancement motion for the customer storefront.
   No requests, form processing, analytics or account information are accessed. */
(()=>{
  'use strict';
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const progress=document.createElement('div');
  progress.className='premium-scroll-line';progress.setAttribute('aria-hidden','true');
  document.body.classList.add('premium-enhanced');document.body.append(progress);
  let queued=false;
  function update(){
    queued=false;
    const max=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    progress.style.width=(Math.min(1,Math.max(0,scrollY/max))*100).toFixed(2)+'%';
  }
  window.addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(update)}},{passive:true});
  window.addEventListener('resize',update,{passive:true});
  const content=document.getElementById('app');
  if(content) new MutationObserver(()=>requestAnimationFrame(update)).observe(content,{childList:true});
  update();
})();
