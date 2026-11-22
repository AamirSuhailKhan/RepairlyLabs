import os
import sys
import time
import ctypes
import pathlib
from playwright.sync_api import sync_playwright

CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_URL = "http://127.0.0.1:3001"

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def bring_chrome_to_foreground():
    user32 = ctypes.windll.user32
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    found_hwnds = []

    def foreach_window(hwnd, lParam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value
            if "Chrome" in title or "RepairlyLabs" in title or "Mobile Repair" in title:
                found_hwnds.append((hwnd, title))
        return True

    user32.EnumWindows(EnumWindowsProc(foreach_window), 0)

    for hwnd, title in found_hwnds:
        log(f"   Foregrounding Window: [hwnd={hwnd}] '{title}'")
        user32.ShowWindow(hwnd, 3) # SW_MAXIMIZE = 3
        user32.SetForegroundWindow(hwnd)
        user32.SwitchToThisWindow(hwnd, True)

def main():
    log("="*70)
    log("PHASE 1: VERIFYING VISIBLE GOOGLE CHROME ON ACTIVE WINDOWS DESKTOP")
    log("="*70)

    # 1. Windows session check
    session_id = ctypes.windll.kernel32.ProcessIdToSessionId
    curr_pid = os.getpid()
    dw_session = ctypes.c_ulong()
    session_id(curr_pid, ctypes.byref(dw_session))
    log(f"1. Current Process PID: {curr_pid}, Active Windows Session ID: {dw_session.value}")

    # 2. Chrome executable and version
    log(f"2. Locating Chrome at: {CHROME_EXE}")
    assert os.path.exists(CHROME_EXE), "Chrome executable does not exist!"
    log("3. Chrome executable verified on disk.")

    # 3. Launch visible Chrome via Playwright with no headless mode
    log("4. Launching Google Chrome in visible HEADED mode (--start-maximized)...")
    pw = sync_playwright().start()

    profile_dir = pathlib.Path("test-results/visible-chrome-profile").resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)

    browser = pw.chromium.launch(
        executable_path=CHROME_EXE,
        headless=False,
        slow_mo=500,
        args=[
            "--start-maximized",
            "--window-size=1600,1000",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
        ]
    )

    context = browser.new_context(
        viewport=None,  # Allows native window maximization
        record_video_dir="test-results/videos/visible_phase1"
    )

    page = context.new_page()
    log(f"5. Navigating to {BASE_URL}/ in Google Chrome...")
    page.goto(f"{BASE_URL}/", wait_until="networkidle")

    time.sleep(1)
    bring_chrome_to_foreground()

    page_title = page.title()
    log(f"6. Chrome page successfully loaded with title: '{page_title}'")

    # -------------------------------------------------------------
    # PHASE 3: FIRST VISIBLE DEMONSTRATION (5 ACTIONS)
    # -------------------------------------------------------------
    log("\n" + "="*70)
    log("PHASE 3: CONDUCTING 5 VISIBLE DEMONSTRATION ACTIONS")
    log("="*70)

    # Action 1: Open RepairlyLabs homepage
    log("Action 1: Homepage is open and displayed.")
    time.sleep(2)

    # Action 2: Scroll smoothly to repair-services section
    log("Action 2: Scrolling smoothly down to the repair-services section...")
    page.evaluate("""
        window.scrollBy({ top: 750, behavior: 'smooth' });
    """)
    time.sleep(2)

    page.evaluate("""
        window.scrollBy({ top: 750, behavior: 'smooth' });
    """)
    time.sleep(2)

    # Action 3: Click the Repairs navigation link
    log("Action 3: Clicking 'Repairs' navigation link...")
    if page.locator(".nav-links a[href='/repairs']:visible").count() > 0:
        page.locator(".nav-links a[href='/repairs']:visible").first.click()
    elif page.locator(".mobile-trigger:visible").count() > 0:
        log("   Mobile view detected; opening hamburger menu...")
        page.locator(".mobile-trigger:visible").first.click()
        time.sleep(1)
        page.locator(".mobile-nav a[href='/repairs']:visible").first.click()
    else:
        page.goto(f"{BASE_URL}/repairs", wait_until="networkidle")
    
    page.wait_for_selector("#booking", timeout=10000)
    log("   Arrived at /repairs page.")
    time.sleep(2)

    # Action 4: Open the repair booking form & scroll into view
    log("Action 4: Scrolling to and focusing repair booking form...")
    page.locator("#booking-form").scroll_into_view_if_needed()
    time.sleep(1)
    page.click("#name")
    page.fill("#name", "Aamir Desktop Witness")
    time.sleep(1)
    log("   Focused and typed customer name into booking form.")

    # Action 5: Navigate to Find a Part and open the parts request page
    log("Action 5: Navigating to Find a Part (/part-request/)...")
    if page.locator(".nav-links a[href='/parts']:visible").count() > 0:
        page.locator(".nav-links a[href='/parts']:visible").first.click()
    elif page.locator(".mobile-trigger:visible").count() > 0:
        page.locator(".mobile-trigger:visible").first.click()
        time.sleep(1)
        page.locator(".mobile-nav a[href='/parts']:visible").first.click()
    else:
        page.goto(f"{BASE_URL}/parts", wait_until="networkidle")
    time.sleep(2)

    # Click the visible Request any mobile part button
    log("   Clicking visible 'Request any mobile part' CTA...")
    page.locator("a[href='/part-request/']:visible").first.click()
    page.wait_for_selector("#enquiry-form", timeout=10000)
    log("   Arrived at India-wide Part Request page (/part-request/).")
    time.sleep(2)

    # Bring to foreground again
    bring_chrome_to_foreground()

    log("\n" + "="*70)
    log("DEMONSTRATION COMPLETE: LEAVING BROWSER OPEN ON SCREEN FOR 60 SECONDS")
    log("="*70)
    log("Observing browser window on monitor... (Press Ctrl+C or wait for completion)")

    # Keep browser open for user to inspect
    for remaining in range(60, 0, -5):
        log(f"   Browser remains open: {remaining}s remaining...")
        time.sleep(5)

    log("Closing browser session...")
    context.close()
    browser.close()
    pw.stop()
    log("Session closed.")

if __name__ == "__main__":
    main()
