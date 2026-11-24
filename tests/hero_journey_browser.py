import os, tempfile, subprocess, socket, time, urllib.request, json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent; out=root/'test-results'/'hero-journey'; out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as data:
 with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 env={k:v for k,v in os.environ.items() if not k.startswith(('RAZORPAY','TWILIO','RL_','PUBLIC_','TRUST_PROXY'))}; env.update(DATA_DIR=data,PORT=str(port),REPAIRLYLABS_IGNORE_DOTENV='1',NODE_ENV='development'); env.pop('REPAIRLYLABS_TEST',None);env.pop('VERCEL',None)
 server=subprocess.Popen(['node','src/server.mjs'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(60):
   try: urllib.request.urlopen(base+'/api/ready',timeout=.3);break
   except Exception:time.sleep(.1)
  with sync_playwright() as pw:
   b=pw.chromium.launch(**({'executable_path':os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {'channel':'chrome'}),headless=os.environ.get('HEADED')!='1'); checks=[]; errors=[]
   def mark(s): checks.append(s);print('PASS',s,flush=True)
   def prepare(page):
    page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/',wait_until='domcontentloaded');page.locator('[data-journey-ready="1"]').wait_for();
   def step(page,n):page.locator(f'[data-hero-step="{n}"]').click();assert page.locator('#hero-step-index').inner_text()==f'0{n+1} / 03';assert page.locator(f'[data-hero-step="{n}"]').get_attribute('aria-pressed')=='true'
   c=b.new_context(viewport={'width':1366,'height':768}); page=c.new_page();prepare(page);page.locator('#rl-brand-intro').wait_for(state='detached',timeout=10000);page.mouse.move(0,0);page.locator('#hero-step-index').wait_for();assert page.locator('#hero-step-index').inner_text()=='01 / 03';page.wait_for_function("document.querySelector('#hero-step-index').textContent==='02 / 03'",timeout=10000);mark('Auto advances after intro');page.wait_for_function("document.querySelector('#hero-step-index').textContent==='03 / 03'",timeout=10000);mark('Auto advances to third service');page.wait_for_function("document.querySelector('#hero-step-index').textContent==='01 / 03'",timeout=10000);mark('Auto loops back to first service');
   page.locator('#hero-step-index').hover();page.wait_for_timeout(150);before=page.locator('#hero-progress-bar').evaluate('(e)=>e.style.transform');page.wait_for_timeout(650);assert page.locator('#hero-progress-bar').evaluate('(e)=>e.style.transform')==before;mark('Hover freezes progress')
   page.locator('#hero-play-toggle').click();page.mouse.move(0,0);page.wait_for_timeout(150);before=page.locator('#hero-progress-bar').evaluate('(e)=>e.style.transform');page.wait_for_timeout(650);assert page.locator('#hero-progress-bar').evaluate('(e)=>e.style.transform')==before;mark('Pause freezes progress');page.locator('#hero-play-toggle').click();page.mouse.move(0,0);page.wait_for_timeout(500);assert page.locator('#hero-progress-bar').evaluate('(e)=>e.style.transform')!=before;mark('Play resumes progress');
   for i in range(3):step(page,i);page.wait_for_timeout(350);page.locator('#hero-editorial').screenshot(path=str(out/f'journey-{i+1}.png'))
   mark('All manual steps and selected states');page.locator('#hero-step-index').click();assert page.locator('#hero-step-index').inner_text()=='01 / 03';mark('Step counter advances');page.locator('#hero-step-cta').click();page.locator('#booking-form').wait_for();assert page.url.endswith('/repairs#booking');mark('Repair CTA opens actual booking form');page.go_back(wait_until='domcontentloaded');page.locator('[data-journey-ready]').wait_for();step(page,1);page.locator('#hero-step-cta').click();page.locator('#enquiry-form').wait_for();mark('Parts CTA opens actual enquiry form');page.go_back(wait_until='domcontentloaded');page.locator('[data-journey-ready]').wait_for();step(page,2);page.locator('#hero-step-cta').click();page.locator('#track-ref').wait_for();mark('Track CTA opens actual repair lookup');page.go_back(wait_until='domcontentloaded');page.locator('[data-journey-ready]').wait_for();step(page,2);page.locator('#hero-secondary-cta').click();page.locator('#lookup-form').wait_for();page.wait_for_timeout(400);assert page.url.endswith('#status-check');assert page.locator('#lookup-form').is_visible();assert page.locator('#status-check').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}');mark('Parts tracking CTA opens and scrolls to private lookup');c.close()
   for w,h in [(360,800),(390,844),(430,932),(768,1024),(1024,768),(1280,800),(1366,768),(1920,1080)]:
    c=b.new_context(viewport={'width':w,'height':h},reduced_motion='reduce');page=c.new_page();prepare(page);assert page.locator('#hero-play-toggle').get_attribute('aria-pressed')=='true';
    for i in range(3):
     step(page,i);bounds=page.evaluate('''()=>{const r=s=>document.querySelector(s).getBoundingClientRect();let a=r('.hero-process-card'),n=r('.hero-editorial-note'),f=r('.process-card-footer'),d=r('.process-dynamic'),rows=r('.process-steps-list');return {card:a.toJSON(),note:n.toJSON(),footer:f.toJSON(),dynamic:d.toJSON(),rows:rows.toJSON(),scroll:document.documentElement.scrollWidth,view:innerWidth}}''');assert bounds['card']['bottom']<=bounds['note']['top']+1,bounds;assert bounds['dynamic']['bottom']<=bounds['rows']['top']+1,bounds;assert bounds['scroll']<=w+1,bounds;assert bounds['card']['right']<=w+1,bounds;assert bounds['card']['left']>=-1,bounds
     if w==360:page.locator('#hero-editorial').screenshot(path=str(out/f'mobile-{i+1}.png'))
    mark(f'{w}×{h}: all 3 states fit; reduced motion defaults paused');c.close()
   assert not errors,errors;mark('No uncaught JavaScript errors');b.close()
   (out/'results.json').write_text(json.dumps({'checks':checks,'pageErrors':errors},indent=2))
 finally:
  server.terminate()
  try: server.wait(timeout=15)
  except subprocess.TimeoutExpired: server.kill();server.wait()
