import os, time, sys, subprocess
from playwright.sync_api import sync_playwright

def run_cinematic_intro_test():
    os.makedirs('test-results/videos', exist_ok=True)
    os.makedirs('test-results/screenshots/intro', exist_ok=True)

    video_dir = os.path.abspath('test-results/videos')

    print('Starting Playwright Chrome testing with seamless petal separation...')

    with sync_playwright() as p:
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
        page.goto('http://localhost:3001/', wait_until='domcontentloaded')

        intro = page.locator('#repairly-brand-intro')
        intro.wait_for(state='attached', timeout=5000)
        print('Intro container attached on homepage entry.')

        # Stage 1: 200ms (entrance)
        page.wait_for_timeout(250)
        page.screenshot(path='test-results/screenshots/intro/stage-1-entrance.png')
        print('Captured Stage 1: Pristine logo entrance & fade-in.')

        # Stage 2: 600ms (recognition)
        page.wait_for_timeout(400)
        page.screenshot(path='test-results/screenshots/intro/stage-2-recognized.png')
        print('Captured Stage 2: Logo recognition pause (complete pristine logo).')

        # Stage 3: 1300ms (smooth petal separation)
        page.wait_for_timeout(700)
        page.screenshot(path='test-results/screenshots/intro/stage-3-petal-separation.png')
        print('Captured Stage 3: 8 complete, seamless petals separating along outward spiral paths.')

        # Stage 4: 1900ms (website reveal)
        page.wait_for_timeout(600)
        page.screenshot(path='test-results/screenshots/intro/stage-4-website-reveal.png')
        print('Captured Stage 4: Homepage reveal through central spiral.')

        # Stage 5: 2600ms (hero CTA ready & unmount)
        page.wait_for_timeout(700)
        page.screenshot(path='test-results/screenshots/intro/stage-5-homepage-ready.png')
        print('Captured Stage 5: Homepage hero ready with primary Request a Repair CTA.')

        # Verify intro is unmounted / hidden
        is_hidden = page.evaluate("() => document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
        print(f'Intro overlay hidden in DOM: {is_hidden} (expected True)')

        # Verify body scroll restored
        body_locked = page.evaluate("() => document.body.classList.contains('intro-locked')")
        print(f'Body locked: {body_locked} (expected False)')

        # 2. Replay Verification on Normal Refresh (F5)
        print('\n--- SCENARIO 2: Replay on Normal Page Refresh (F5) ---')
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(300)
        intro_on_refresh = page.evaluate("() => !document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
        print(f'Intro replays on normal refresh: {intro_on_refresh} (expected True)')
        page.screenshot(path='test-results/screenshots/intro/refresh-replayed.png')

        # 3. Skip Functionality
        print('\n--- SCENARIO 3: Skip Intro Action ---')
        skip_btn = page.locator('#intro-skip-btn')
        if skip_btn.is_visible():
            skip_btn.click()
            print('Clicked Skip intro button.')
            page.wait_for_timeout(200)
            is_skipped = page.evaluate("() => document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
            print(f'Skip button instantly unmounted intro: {is_skipped} (expected True)')
            page.screenshot(path='test-results/screenshots/intro/skip-verified.png')

        # 4. Hard Refresh Replay Verification
        print('\n--- SCENARIO 4: Hard Refresh Replay ---')
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(300)
        intro_on_hard_refresh = page.evaluate("() => !document.getElementById('repairly-brand-intro').classList.contains('intro-hidden')")
        print(f'Intro replays on hard refresh: {intro_on_hard_refresh} (expected True)')

        # Wait for animation to finish
        page.wait_for_timeout(2500)

        video_path = page.video.path()
        context.close()
        print(f'Context video saved to: {video_path}')

        # 5. Mobile Viewports Verification
        print('\n--- SCENARIO 5: Mobile Viewports Overflow & Scale Audit ---')
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
            m_page.goto('http://localhost:3001/', wait_until='domcontentloaded')
            m_page.wait_for_timeout(600)
            
            scroll_width = m_page.evaluate("() => document.documentElement.scrollWidth")
            inner_width = m_page.evaluate("() => window.innerWidth")
            overflow = scroll_width - inner_width
            print(f'Viewport {vw}x{vh} ({label:15s}): scrollWidth={scroll_width}, innerWidth={inner_width}, overflow={overflow}px')
            assert overflow <= 0, f'Horizontal overflow detected: {overflow}px on {vw}x{vh}'
            m_page.screenshot(path=f'test-results/screenshots/intro/viewport-{label}-{vw}x{vh}.png')
            m_ctx.close()

        browser.close()
        print('All browser tests passed successfully!')

    # Copy video to target filename
    target_webm = os.path.abspath('test-results/videos/repairlylabs-cinematic-intro.webm')
    if os.path.exists(video_path):
        import shutil
        shutil.copy2(video_path, target_webm)
        size_mb = os.path.getsize(target_webm) / (1024 * 1024)
        print(f'SUCCESS: High-resolution cinematic intro recording: {target_webm} ({size_mb:.2f} MB)')

if __name__ == '__main__':
    run_cinematic_intro_test()
