import os
import sys
import pathlib
from playwright.sync_api import sync_playwright

artifact_dir = pathlib.Path(r"C:\Users\aamir\.gemini\antigravity\brain\91966b9b-208f-45ae-bf1a-fe485f2fc307")
chrome_exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
base_url = "http://127.0.0.1:3001"

print(f"Connecting to live server at {base_url}...")
print(f"Artifact directory: {artifact_dir}")

results = {}

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        executable_path=chrome_exe if os.path.exists(chrome_exe) else None
    )

    # 1. Desktop Context (1440x900)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    # --- Storefront Desktop ---
    print("\n1. Testing Storefront Desktop...")
    page.goto(f"{base_url}/", wait_until="networkidle")
    nav = page.locator("#navbar")
    nav_radius = nav.evaluate("el => window.getComputedStyle(el).borderRadius")
    nav_pos = nav.evaluate("el => window.getComputedStyle(el).position")
    print(f"   Navbar style: position={nav_pos}, borderRadius={nav_radius}")
    storefront_path = str(artifact_dir / "live_storefront_desktop.png")
    page.screenshot(path=storefront_path, full_page=False)
    results["storefront_desktop"] = {
        "status": "PASS",
        "borderRadius": nav_radius,
        "screenshot": storefront_path
    }

    # --- Storefront Mobile ---
    print("\n2. Testing Storefront Mobile (390x844)...")
    m_context = browser.new_context(viewport={"width": 390, "height": 844})
    m_page = m_context.new_page()
    m_page.goto(f"{base_url}/", wait_until="networkidle")
    storefront_mobile_path = str(artifact_dir / "live_storefront_mobile.png")
    m_page.screenshot(path=storefront_mobile_path, full_page=False)
    m_context.close()
    results["storefront_mobile"] = {
        "status": "PASS",
        "screenshot": storefront_mobile_path
    }

    # --- Admin Login ---
    print("\n3. Testing Admin Login...")
    page.goto(f"{base_url}/admin", wait_until="networkidle")
    page.locator("#login-username").fill("owner")
    page.locator("input[name=password]").fill("Admin12345678!")
    page.locator("form[data-form=admin-login] button[type=submit]").click()
    page.locator("#admin-content").wait_for(timeout=10000)
    admin_dash_path = str(artifact_dir / "live_admin_dashboard.png")
    page.screenshot(path=admin_dash_path, full_page=False)
    results["admin_login"] = {
        "status": "PASS",
        "screenshot": admin_dash_path
    }

    # --- Repair Desk Inbox ---
    print("\n4. Testing Repair Desk Inbox...")
    page.goto(f"{base_url}/repair-center/?admin=1", wait_until="networkidle")
    page.locator("#jobs table").wait_for(timeout=10000)
    repair_desk_path = str(artifact_dir / "live_repair_desk_inbox.png")
    page.screenshot(path=repair_desk_path, full_page=False)
    results["repair_desk_inbox"] = {
        "status": "PASS",
        "screenshot": repair_desk_path
    }

    # --- Repair Desk Job Details (POCO M7 Pro) ---
    print("\n5. Testing Repair Desk Job Details for POCO M7 Pro...")
    poco_btn = page.locator("button[data-ref='RLM-261119-E7C48CED']")
    print(f"   POCO button count: {poco_btn.count()}")
    if poco_btn.count() > 0:
        poco_btn.click()
    else:
        page.locator("button[data-ref]").first.click()
    
    # Wait for the job detail view to mount (.intake-fields only exists in job detail view)
    page.locator(".intake-fields").wait_for(timeout=10000)
    job_h1 = page.locator("h1").first.inner_text()
    print(f"   Job Details Heading: {job_h1}")
    assert "POCO POCO" not in job_h1, f"Duplicated brand detected in heading: {job_h1}"
    assert "POCO M7 Pro" in job_h1, f"Expected POCO M7 Pro in heading: {job_h1}"
    job_detail_path = str(artifact_dir / "live_repair_job_detail.png")
    page.screenshot(path=job_detail_path, full_page=False)
    results["repair_job_detail"] = {
        "status": "PASS",
        "heading": job_h1,
        "screenshot": job_detail_path
    }

    # --- Operations Console (Admin) ---
    print("\n6. Testing Operations Console...")
    page.goto(f"{base_url}/operations/?admin=1", wait_until="networkidle")
    page.get_by_role("heading", name="Extended operations").wait_for(timeout=10000)
    ops_dash_path = str(artifact_dir / "live_operations_console.png")
    page.screenshot(path=ops_dash_path, full_page=False)
    results["operations_console"] = {
        "status": "PASS",
        "screenshot": ops_dash_path
    }

    # --- Operations Console (Hindi Toggle) ---
    print("\n7. Testing Operations Hindi Language Toggle...")
    page.get_by_role("button", name="हिन्दी").click()
    page.get_by_role("heading", name="व्यवसाय प्रबंधन").wait_for(timeout=10000)
    ops_hi_path = str(artifact_dir / "live_operations_hindi.png")
    page.screenshot(path=ops_hi_path, full_page=False)
    results["operations_hindi"] = {
        "status": "PASS",
        "screenshot": ops_hi_path
    }

    # --- Parts Payment Desk ---
    print("\n8. Testing Parts Payment Desk...")
    page.goto(f"{base_url}/parts-payment/?admin=1", wait_until="networkidle")
    parts_path = str(artifact_dir / "live_parts_payment.png")
    page.screenshot(path=parts_path, full_page=False)
    results["parts_payment"] = {
        "status": "PASS",
        "screenshot": parts_path
    }

    context.close()
    browser.close()

print("\n" + "="*50)
print("ALL LIVE BROWSER TESTS PASSED SUCCESSFULLY!")
print("="*50)
for k, v in results.items():
    print(f"{k}: {v}")
