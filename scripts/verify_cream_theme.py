import os
from playwright.sync_api import sync_playwright

def verify_theme():
    out_dir = 'test-results/screenshots/cream_theme'
    os.makedirs(out_dir, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
        )
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Homepage
        print('Testing / (Homepage)...')
        page.goto('http://localhost:3001/', wait_until='networkidle')
        # Wait for intro to finish if present
        page.wait_for_timeout(3000)
        page.screenshot(path=f'{out_dir}/homepage-cream.png', full_page=False)
        print('Saved homepage screenshot.')

        # 2. Repairs page
        print('Testing /repairs...')
        page.goto('http://localhost:3001/repairs', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/repairs-cream.png', full_page=False)
        print('Saved repairs screenshot.')

        # 3. Parts page
        print('Testing /parts...')
        page.goto('http://localhost:3001/parts', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/parts-cream.png', full_page=False)
        print('Saved parts screenshot.')

        # 4. Part request portal
        print('Testing /part-request/...')
        page.goto('http://localhost:3001/part-request/', wait_until='networkidle')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{out_dir}/part-request-cream.png', full_page=False)
        print('Saved part-request screenshot.')

        # 5. Mobile homepage
        m_ctx = browser.new_context(viewport={'width': 390, 'height': 844})
        m_page = m_ctx.new_page()
        m_page.goto('http://localhost:3001/', wait_until='networkidle')
        m_page.wait_for_timeout(3000)
        m_page.screenshot(path=f'{out_dir}/mobile-cream.png', full_page=False)
        print('Saved mobile screenshot.')

        browser.close()
        print('All screenshots captured successfully!')

if __name__ == '__main__':
    verify_theme()
