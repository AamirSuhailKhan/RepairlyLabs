"""Run on a trusted machine with Python Playwright and Chromium installed. Uses an isolated database, no live providers."""
import os, tempfile, subprocess, time, pathlib, json, shutil, urllib.request
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='repairly-e2e-') as data:
    env={**os.environ,'DATA_DIR':data,'REPAIRLYLABS_TEST':'1','NODE_ENV':'test'}
    for k in list(env):
        if k.startswith(('RAZORPAY_','TWILIO_','RL_WA_','RL_RESEND_','RL_NOTIFY_','NOTIFY_WEBHOOK_')): env[k]=''
    for k in ['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','RL_GATEWAY_QR_ENABLED','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID','RL_WA_TOKEN','RL_RESEND_KEY','RL_NOTIFY_URL','NOTIFY_WEBHOOK_URL','PUBLIC_ORIGIN','RL_MFA_KEY']:
        env[k]=''
    js="""import {server,db} from './src/server.mjs';import {issueRecovery,recoverOwner} from './src/admin-access.mjs';recoverOwner(db,{token:issueRecovery(db),password:'browser-test-8'});server.listen(0,'127.0.0.1',()=>console.log('PORT='+server.address().port));"""
    proc=subprocess.Popen(['node','--input-type=module','-e',js],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        line=proc.stdout.readline().strip();assert line.startswith('PORT='),line
        base='http://127.0.0.1:'+line.split('=')[1]
        with sync_playwright() as pw:
            executable=os.environ.get('CHROMIUM_PATH') or (r'C:\Program Files\Google\Chrome\Application\chrome.exe' if os.path.exists(r'C:\Program Files\Google\Chrome\Application\chrome.exe') else shutil.which('chromium')) or None
            browser=pw.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
            for width,height in [(1440,900),(390,844)]:
                context=browser.new_context(viewport={'width':width,'height':height});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#login-username').fill('owner');page.locator('input[name=password]').fill('browser-test-8');page.locator('form[data-form=admin-login] button[type=submit]').click();page.locator('#admin-content').wait_for();page.goto(base+'/operations/?admin=1');page.get_by_role('heading',name='Extended operations').wait_for();page.locator('#supplier input[name=name]').fill('Browser Supplier');page.locator('#supplier button').click();page.locator('#supplier-list').get_by_text('Browser Supplier',exact=False).first.wait_for();page.get_by_role('button',name='हिन्दी').click();page.get_by_role('heading',name='व्यवसाय प्रबंधन').wait_for();page.goto(base+'/repair-center/?admin=1');page.get_by_role('heading',name='Customer repair inbox').wait_for();assert not errors,errors;context.close()
            browser.close()
        print('PASS: desktop and mobile login, operations, supplier creation, language switch, repair desk')
    finally:
        proc.terminate();proc.wait(timeout=10)
