import os, time, shutil
from playwright.sync_api import sync_playwright

def verify_champagne():
    out_dir = 'test-results/screenshots/champagne'
    video_dir = 'test-results/videos'
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(video_dir, exist_ok=True)

    print('Launching real Google Chrome for Warm Blush Champagne verification...')
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
        )
        context = browser.new_context(
            viewport={'width': 1280, 'height': 800},
            record_video_dir=video_dir,
            record_video_size={'width': 1280, 'height': 800}
        )
        page = context.new_page()

        # 1. Homepage & Hero
        print('1. Testing / (Homepage) & Warm Blush Champagne Hero...')
        page.goto('http://localhost:3001/', wait_until='networkidle')
        page.wait_for_timeout(2500) # Wait for intro overlay to finish
        page.screenshot(path=f'{out_dir}/01-homepage-champagne.png', full_page=False)

        # Inspect computed styles of navbar and hero
        nav_bg = page.locator('.navbar').evaluate('el => window.getComputedStyle(el).backgroundColor')
        nav_color = page.locator('.navbar .nav-links a').first.evaluate('el => window.getComputedStyle(el).color')
        hero_color = page.locator('.hero h1').evaluate('el => window.getComputedStyle(el).color')
        print(f'Navbar computed background: {nav_bg}')
        print(f'Navbar computed link color: {nav_color}')
        print(f'Hero heading computed color: {hero_color}')

        # 2. Automated Color Audit: Verify zero brown background surfaces
        print('\n--- AUTOMATED COLOR AUDIT: Checking for obsolete brown surfaces ---')
        selectors_to_check = [
            ('.navbar', 'Navbar'),
            ('.hero', 'Hero'),
            ('.brand-strip', 'Brand Strip'),
            ('.process', 'Process Section'),
            ('.cta-strip', 'CTA Strip'),
            ('.site-footer', 'Footer')
        ]
        banned_browns = [
            'rgb(53, 45, 41)',   # #352d29
            'rgb(74, 59, 52)',   # #4a3b34
            'rgb(41, 35, 32)',   # #292320
            'rgb(48, 40, 32)'    # #302820
        ]
        for sel, label in selectors_to_check:
            loc = page.locator(sel)
            if loc.count() > 0:
                bg = loc.first.evaluate('el => window.getComputedStyle(el).backgroundColor')
                print(f'{label} ({sel}) computed background: {bg}')
                for brown in banned_browns:
                    assert brown not in bg, f'FAIL: Obsolete brown {brown} detected on {label}!'

        # 3. Replay on Refresh (F5)
        print('\n2. Testing Replay on Refresh (F5)...')
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(250)
        intro_present = page.locator('#rl-brand-intro').count() > 0
        print(f'Intro replays on refresh: {intro_present} (expected True)')
        page.wait_for_timeout(2500)

        # 4. Scroll through homepage sections
        print('\n3. Scrolling through homepage sections...')
        page.evaluate("window.scrollTo(0, 900)")
        page.wait_for_timeout(600)
        page.screenshot(path=f'{out_dir}/02-homepage-process.png', full_page=False)

        page.evaluate("window.scrollTo(0, 2200)")
        page.wait_for_timeout(600)
        page.screenshot(path=f'{out_dir}/03-homepage-footer.png', full_page=False)

        # 5. Inner Pages
        print('\n4. Testing /repairs...')
        page.goto('http://localhost:3001/repairs', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/04-repairs-champagne.png', full_page=False)

        print('5. Testing /parts...')
        page.goto('http://localhost:3001/parts', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/05-parts-champagne.png', full_page=False)

        print('6. Testing /part-request/...')
        page.goto('http://localhost:3001/part-request/', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/06-part-request-champagne.png', full_page=False)

        video_path = page.video.path()
        context.close()
        print(f'Context video saved to: {video_path}')

        # 6. Responsive Viewports Audit (360px to 1920px)
        print('\n7. Testing responsive viewports for overflow & geometry...')
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
            m_page.goto('http://localhost:3001/', wait_until='networkidle')
            m_page.wait_for_timeout(2500)
            scroll_width = m_page.evaluate("() => document.documentElement.scrollWidth")
            inner_width = m_page.evaluate("() => window.innerWidth")
            overflow = scroll_width - inner_width
            print(f'Viewport {vw}x{vh} ({label:15s}): scrollWidth={scroll_width}, innerWidth={inner_width}, overflow={overflow}px')
            assert overflow <= 0, f'Horizontal overflow detected: {overflow}px on {vw}x{vh}'
            m_page.screenshot(path=f'{out_dir}/viewport-{label}-{vw}x{vh}.png')
            m_ctx.close()

        browser.close()
        print('\nAll Warm Blush Champagne verification checks passed successfully!')

    # Copy video to target filename
    target_webm = os.path.abspath('test-results/videos/repairlylabs-champagne-color-update.webm')
    if os.path.exists(video_path):
        shutil.copy2(video_path, target_webm)
        size_mb = os.path.getsize(target_webm) / (1024 * 1024)
        print(f'SUCCESS: High-resolution champagne demonstration video: {target_webm} ({size_mb:.2f} MB)')

if __name__ == '__main__':
    verify_champagne()
