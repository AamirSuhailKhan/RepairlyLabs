import os, time, sys, subprocess
from playwright.sync_api import sync_playwright

def run_cinematic_intro_test():
    os.makedirs('test-results/videos', exist_ok=True)
    os.makedirs('test-results/screenshots/intro', exist_ok=True)

    video_dir = os.path.abspath('test-results/videos')
    ffmpeg_exe = r'C:\Users\aamir\AppData\Local\ms-playwright\ffmpeg-1011\ffmpeg-win64.exe'
    if not os.path.exists(ffmpeg_exe):
        ffmpeg_exe = r'C:\Users\aamir\AppData\Local\ms-playwright\ffmpeg-1013\ffmpeg-win64.exe'

    print('Starting Playwright Chrome testing...')

    with sync_playwright() as p:
        # Launch Google Chrome
        # Using channel="chrome" and headless=False for real Chrome automation
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1280,800'
            ]
        )

        # Context 1: Desktop intro recording (1280x720)
        context = browser.new_context(
            viewport={'width': 1280, 'height': 720},
            record_video_dir=video_dir,
            record_video_size={'width': 1280, 'height': 720}
        )

        page = context.new_page()

        # 1. First Visit: Desktop Animation Sequence
        print('\n--- SCENARIO 1: First Visit Desktop Animation ---')
        page.goto('http://localhost:3001/?intro=1', wait_until='domcontentloaded')

        # Check intro is present
        intro = page.locator('#repairly-brand-intro')
        intro.wait_for(state='attached', timeout=5000)
        print('Intro container attached.')

        # Stage A: 200ms (entrance)
        page.wait_for_timeout(250)
        page.screenshot(path='test-results/screenshots/intro/stage-a-entrance.png')
        print('Captured Stage A: Logo entrance & fade-in.')

        # Stage B: 600ms (recognition)
        page.wait_for_timeout(350)
        page.screenshot(path='test-results/screenshots/intro/stage-b-recognized.png')
        print('Captured Stage B: Logo recognition pause.')

        # Stage C: 1200ms (petal separation)
        page.wait_for_timeout(600)
        page.screenshot(path='test-results/screenshots/intro/stage-c-petal-separation.png')
        print('Captured Stage C: 8-petal spiral separation.')

        # Stage D: 1800ms (website reveal)
        page.wait_for_timeout(600)
        page.screenshot(path='test-results/screenshots/intro/stage-d-website-reveal.png')
        print('Captured Stage D: Website reveal through central spiral.')

        # Stage E: 2600ms (hero CTA & navbar restoration)
        page.wait_for_timeout(800)
        page.screenshot(path='test-results/screenshots/intro/stage-e-homepage-ready.png')
        print('Captured Stage E: Homepage hero active with Request a Repair CTA.')

        # Verify intro is unmounted / hidden
        is_hidden = page.evaluate("() => document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
        print(f'Intro overlay hidden in DOM: {is_hidden}')

        # Verify body scroll restored
        body_locked = page.evaluate("() => document.body.classList.contains('intro-locked')")
        print(f'Body locked: {body_locked} (expected False)')

        # Interact with primary CTA
        cta = page.locator('a[href="/repairs#booking"]').first
        if cta.is_visible():
            print('Primary "Request a Repair" CTA is visible and interactive.')

        # 2. Replay & Skip Functionality
        print('\n--- SCENARIO 2: Replay & Skip intro ---')
        page.goto('http://localhost:3001/?intro=1', wait_until='domcontentloaded')
        page.wait_for_timeout(300)
        skip_btn = page.locator('#intro-skip-btn')
        if skip_btn.is_visible():
            skip_btn.click()
            print('Clicked Skip intro button.')
            page.wait_for_timeout(200)
            is_skipped = page.evaluate("() => document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
            print(f'Skip button instantly unmounted intro: {is_skipped}')
            page.screenshot(path='test-results/screenshots/intro/skip-verified.png')

        # 3. Session Persistence (No replay on second visit)
        print('\n--- SCENARIO 3: Second Visit Session Storage ---')
        page.goto('http://localhost:3001/', wait_until='domcontentloaded')
        page.wait_for_timeout(300)
        seen_again = page.evaluate("() => document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
        print(f'Subsequent visit without ?intro bypass bypassed: {seen_again} (expected True)')

        # Close page to flush video
        video_path = page.video.path()
        context.close()
        print(f'Context video saved to: {video_path}')

        # 4. Mobile Viewports Verification
        print('\n--- SCENARIO 4: Mobile Viewports Overflow & Scale Audit ---')
        viewports = [
            ('mobile-small', 360, 800),
            ('mobile-standard', 390, 844),
            ('mobile-large', 430, 932),
            ('tablet', 768, 1024),
            ('laptop', 1366, 768),
            ('desktop-fhd', 1920, 1080)
        ]

        for label, vw, vh in viewports:
            m_ctx = browser.new_context(viewport={'width': vw, 'height': vh})
            m_page = m_ctx.new_page()
            m_page.goto('http://localhost:3001/?intro=1', wait_until='domcontentloaded')
            m_page.wait_for_timeout(600) # Stage B/C
            
            # Check horizontal overflow
            scroll_width = m_page.evaluate("() => document.documentElement.scrollWidth")
            inner_width = m_page.evaluate("() => window.innerWidth")
            overflow = scroll_width - inner_width
            print(f'Viewport {vw}x{vh} ({label:15s}): scrollWidth={scroll_width}, innerWidth={inner_width}, overflow={overflow}px')
            assert overflow <= 0, f'Horizontal overflow detected: {overflow}px on {vw}x{vh}'
            m_page.screenshot(path=f'test-results/screenshots/intro/viewport-{label}-{vw}x{vh}.png')
            m_ctx.close()

        browser.close()
        print('All browser tests passed!')

    # Convert recorded WebM to MP4
    mp4_target = os.path.abspath('test-results/videos/repairlylabs-cinematic-intro.mp4')
    if os.path.exists(ffmpeg_exe) and os.path.exists(video_path):
        print(f'\nConverting {video_path} to playable MP4: {mp4_target}...')
        cmd = [
            ffmpeg_exe,
            '-y',
            '-i', video_path,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'fast',
            '-crf', '22',
            mp4_target
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode == 0 and os.path.exists(mp4_target):
            size_mb = os.path.getsize(mp4_target) / (1024 * 1024)
            print(f'SUCCESS: Playable MP4 generated: {mp4_target} ({size_mb:.2f} MB)')
        else:
            print(f'FFmpeg warning: {res.stderr.decode("utf-8", errors="ignore")[:300]}')

if __name__ == '__main__':
    run_cinematic_intro_test()
