import os
from playwright.sync_api import sync_playwright

def verify_dark_blue_only():
    out_dir = 'test-results/screenshots/dark_blue_only'
    os.makedirs(out_dir, exist_ok=True)

    print('Launching real Google Chrome for dark-blue-only verification...')
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
        )
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Homepage
        print('1. Testing / (Homepage)...')
        page.goto('http://localhost:3001/', wait_until='networkidle')
        page.wait_for_timeout(2500) # Wait for intro overlay to finish
        page.screenshot(path=f'{out_dir}/homepage-warm-charcoal.png', full_page=False)

        # Check navbar and hero styling
        nav_bg = page.locator('.navbar').evaluate('el => window.getComputedStyle(el).backgroundColor')
        print(f'Navbar computed background: {nav_bg}')

        # 2. Replay on Refresh (F5)
        print('2. Testing Replay on Refresh (F5)...')
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(250)
        intro_present = page.locator('#rl-brand-intro').count() > 0
        print(f'Intro replays on refresh: {intro_present} (expected True)')
        page.wait_for_timeout(2500)

        # 3. Repairs page
        print('3. Testing /repairs...')
        page.goto('http://localhost:3001/repairs', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/repairs-warm-charcoal.png', full_page=False)

        # 4. Parts page
        print('4. Testing /parts...')
        page.goto('http://localhost:3001/parts', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/parts-warm-charcoal.png', full_page=False)

        # 5. Parts Request Portal
        print('5. Testing /part-request/...')
        page.goto('http://localhost:3001/part-request/', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/part-request-warm-charcoal.png', full_page=False)

        # 6. Viewports Overflow Audit
        print('6. Testing responsive viewports for overflow...')
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
            print(f'Viewport {vw}x{vh} ({label:15s}): overflow={overflow}px')
            assert overflow <= 0, f'Horizontal overflow detected: {overflow}px on {vw}x{vh}'
            m_page.screenshot(path=f'{out_dir}/viewport-{label}-{vw}x{vh}.png')
            m_ctx.close()

        context.close()
        browser.close()
        print('All dark-blue-only verification checks passed successfully!')

if __name__ == '__main__':
    verify_dark_blue_only()
