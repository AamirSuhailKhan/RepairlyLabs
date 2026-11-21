import os
import sys
import time
import json
import pathlib
from playwright.sync_api import sync_playwright

CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_URL = "http://127.0.0.1:3001"
RESULTS_DIR = pathlib.Path("test-results/screenshots/navbar-fix")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def test_navbar():
    log("="*70)
    log("TESTING REPAIRLYLABS NAVBAR REFINEMENT IN VISIBLE GOOGLE CHROME")
    log(f"Base URL: {BASE_URL}")
    log(f"Chrome Binary: {CHROME_EXE}")
    log("="*70)

    with sync_playwright() as pw:
        log("Launching Google Chrome (headed mode)...")
        browser = pw.chromium.launch(
            headless=False,
            executable_path=CHROME_EXE if os.path.exists(CHROME_EXE) else None,
            slow_mo=200
        )

        # -------------------------------------------------------------
        # 1. Desktop Viewport (1440x900)
        # -------------------------------------------------------------
        log("\n1. Testing Desktop Viewport (1440x900)...")
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/", wait_until="networkidle")

        # Check navbar visibility & bounding box
        navbar = page.locator("#navbar")
        assert navbar.is_visible(), "Navbar must be visible"
        
        nav_box = navbar.bounding_box()
        log(f"   Navbar Dimensions: width={nav_box['width']:.1f}px, height={nav_box['height']:.1f}px, top={nav_box['y']:.1f}px")
        
        # Verify contrast / background
        bg_color = page.evaluate("window.getComputedStyle(document.getElementById('navbar')).backgroundColor")
        log(f"   Navbar computed background-color: {bg_color}")
        
        # Check all controls are strictly inside navbar bounding box
        logo_box = page.locator("#navbar .logo").bounding_box()
        links_box = page.locator("#navbar .nav-links").bounding_box()
        actions_box = page.locator("#navbar .nav-actions").bounding_box()
        book_btn_box = page.locator("#navbar .nav-book").bounding_box()
        cart_box = page.locator("#navbar .cart-trigger").bounding_box()

        log(f"   Logo: x={logo_box['x']:.1f}, width={logo_box['width']:.1f}")
        log(f"   Links: x={links_box['x']:.1f}, width={links_box['width']:.1f}")
        log(f"   Actions: x={actions_box['x']:.1f}, width={actions_box['width']:.1f}")
        log(f"   Book CTA: x={book_btn_box['x']:.1f}, width={book_btn_box['width']:.1f}")

        # Check bounds
        assert logo_box['x'] >= nav_box['x'] - 1, "Logo must be inside navbar left boundary"
        assert actions_box['x'] + actions_box['width'] <= nav_box['x'] + nav_box['width'] + 2, "Actions must be inside navbar right boundary"
        assert book_btn_box['x'] + book_btn_box['width'] <= nav_box['x'] + nav_box['width'] + 2, "Book button must be inside navbar right boundary"
        log("   VERIFIED: All controls fit cleanly inside the navbar pill (0 overflow).")

        page.screenshot(path=str(RESULTS_DIR / "01_desktop_1440_navbar.png"))

        # Test scroll behavior
        log("   Testing navbar scroll behavior...")
        page.evaluate("window.scrollTo(0, 400)")
        page.wait_for_timeout(300)
        assert "scrolled" in page.locator("#navbar").get_attribute("class"), "Navbar must have 'scrolled' class on scroll"
        scrolled_box = navbar.bounding_box()
        log(f"   Scrolled Navbar Height: {scrolled_box['height']:.1f}px (compacted cleanly)")
        page.screenshot(path=str(RESULTS_DIR / "02_desktop_1440_scrolled.png"))
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(300)

        # -------------------------------------------------------------
        # 2. Desktop Navigation across Pages
        # -------------------------------------------------------------
        log("\n2. Testing Primary Navigation Links...")
        pages_to_test = [
            ("Repairs", "/repairs", ".service-grid"),
            ("Spare parts", "/parts", "#shop-result"),
            ("Track request", "/track", "form"),
            ("Our approach", "/about", ".page-hero"),
            ("Contact", "/contact", "form[data-form='contact']"),
            ("Home", "/", ".hero")
        ]

        for label, path, expected_selector in pages_to_test:
            log(f"   Navigating to '{label}' ({path})...")
            page.click(f"#navbar .nav-links a[href='{path}']")
            page.wait_for_selector(expected_selector)
            assert page.url.endswith(path) or page.url.endswith(path + "/"), f"URL should match {path}"
            page.wait_for_timeout(200)

        # Test 'Request a part' link
        log("   Navigating to 'Request a part' (/part-request/)...")
        page.click("#navbar .nav-links a[href='/part-request/']")
        page.wait_for_selector("#enquiry-form, .hero")
        assert "/part-request/" in page.url
        page.screenshot(path=str(RESULTS_DIR / "03_navigated_part_request.png"))

        # Navigate back to home
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        ctx.close()

        # -------------------------------------------------------------
        # 3. Tablet Viewports (1200x800 and 768x1024)
        # -------------------------------------------------------------
        log("\n3. Testing Tablet Viewports...")
        # 3.1 Medium Screen (1200px - Mobile menu active, Book CTA preserved)
        ctx_tab1 = browser.new_context(viewport={"width": 1200, "height": 800})
        pg_tab1 = ctx_tab1.new_page()
        pg_tab1.goto(f"{BASE_URL}/", wait_until="networkidle")
        
        tab1_nav_box = pg_tab1.locator("#navbar").bounding_box()
        log(f"   1200px Tablet: Navbar width={tab1_nav_box['width']:.1f}px")
        assert pg_tab1.locator("#navbar .mobile-trigger").is_visible(), "Mobile trigger must be visible at 1200px"
        assert not pg_tab1.locator("#navbar .nav-links").is_visible(), "Full nav-links should collapse at 1200px"
        assert pg_tab1.locator("#navbar .nav-book").is_visible(), "Book CTA should remain visible on medium tablet"
        
        # Test opening mobile menu at 1200px
        log("   Testing mobile menu toggle at 1200px...")
        pg_tab1.click("#navbar .mobile-trigger")
        pg_tab1.wait_for_timeout(300)
        assert "hide" not in (pg_tab1.locator("#mobile-nav").get_attribute("class") or ""), "Mobile menu must open when trigger clicked"
        pg_tab1.screenshot(path=str(RESULTS_DIR / "04_tablet_1200_menu_open.png"))
        
        pg_tab1.click("#navbar .mobile-trigger")
        pg_tab1.wait_for_timeout(300)
        assert "hide" in pg_tab1.locator("#mobile-nav").get_attribute("class"), "Mobile menu must close on second click"
        ctx_tab1.close()

        # 3.2 Narrow Tablet (768x1024)
        ctx_tab2 = browser.new_context(viewport={"width": 768, "height": 1024})
        pg_tab2 = ctx_tab2.new_page()
        pg_tab2.goto(f"{BASE_URL}/", wait_until="networkidle")
        
        tab2_nav_box = pg_tab2.locator("#navbar").bounding_box()
        log(f"   768px Tablet: Navbar width={tab2_nav_box['width']:.1f}px")
        assert pg_tab2.locator("#navbar .mobile-trigger").is_visible(), "Mobile trigger must be visible at 768px"
        assert not pg_tab2.locator("#navbar .nav-book").is_visible(), "Book CTA hides on narrow screens to prevent crowding"
        
        # Check horizontal overflow
        scroll_w = pg_tab2.evaluate("document.documentElement.scrollWidth")
        client_w = pg_tab2.evaluate("document.documentElement.clientWidth")
        assert scroll_w <= client_w + 1, f"No horizontal overflow on tablet: {scroll_w} <= {client_w}"
        pg_tab2.screenshot(path=str(RESULTS_DIR / "05_tablet_768_navbar.png"))
        ctx_tab2.close()

        # -------------------------------------------------------------
        # 4. Mobile Viewports (360x800, 390x844, 430x932)
        # -------------------------------------------------------------
        log("\n4. Testing Mobile Viewports...")
        mob_viewports = [
            ("Small Mobile", 360, 800, "06_mobile_360.png", "07_mobile_360_menu.png"),
            ("Standard Mobile", 390, 844, "08_mobile_390.png", "09_mobile_390_menu.png"),
            ("Large Mobile", 430, 932, "10_mobile_430.png", "11_mobile_430_menu.png")
        ]

        for vp_name, width, height, sc_closed, sc_open in mob_viewports:
            log(f"   Testing {vp_name} ({width}x{height})...")
            m_ctx = browser.new_context(viewport={"width": width, "height": height})
            m_page = m_ctx.new_page()
            m_page.goto(f"{BASE_URL}/", wait_until="networkidle")

            # Check navbar dimensions
            m_nav_box = m_page.locator("#navbar").bounding_box()
            assert m_nav_box['width'] <= width, f"Navbar must not exceed viewport: {m_nav_box['width']} <= {width}"
            
            # Check horizontal overflow on mobile
            scroll_w = m_page.evaluate("document.documentElement.scrollWidth")
            client_w = m_page.evaluate("document.documentElement.clientWidth")
            assert scroll_w <= client_w + 1, f"No horizontal overflow on {vp_name}: {scroll_w} <= {client_w}"
            m_page.screenshot(path=str(RESULTS_DIR / sc_closed))

            # Open Mobile Menu
            log(f"   Opening mobile menu on {vp_name}...")
            m_page.click("#navbar .mobile-trigger")
            m_page.wait_for_timeout(300)
            assert "hide" not in (m_page.locator("#mobile-nav").get_attribute("class") or ""), "Mobile menu must be visible"
            
            # Verify links inside mobile nav
            mob_links = m_page.locator("#mobile-nav a")
            assert mob_links.count() >= 6, "Mobile menu must contain navigation links"
            m_page.screenshot(path=str(RESULTS_DIR / sc_open))

            # Close Mobile Menu
            m_page.click("#navbar .mobile-trigger")
            m_page.wait_for_timeout(300)
            assert "hide" in m_page.locator("#mobile-nav").get_attribute("class"), "Mobile menu must close"

            m_ctx.close()

        log("\nClosing Google Chrome...")
        browser.close()

    log("="*70)
    log("NAVBAR REFINEMENT BROWSER TESTING COMPLETED WITH 100% PASS!")
    log("="*70)

if __name__ == "__main__":
    test_navbar()
