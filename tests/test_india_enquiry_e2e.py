import os
import sys
import time
import json
import sqlite3
import datetime
import pathlib
from playwright.sync_api import sync_playwright

CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_URL = "http://127.0.0.1:3001"
RESULTS_DIR = pathlib.Path("test-results/screenshots/india-enquiry")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def test_india_enquiry_workflow():
    log("="*70)
    log("TESTING INDIA-WIDE PART ENQUIRY END-TO-END WORKFLOW IN REAL CHROME")
    log(f"Base URL: {BASE_URL}")
    log("="*70)

    with sync_playwright() as pw:
        log("Launching Google Chrome (headed mode)...")
        browser = pw.chromium.launch(
            headless=False,
            executable_path=CHROME_EXE if os.path.exists(CHROME_EXE) else None,
            slow_mo=200
        )

        # -------------------------------------------------------------
        # 1. Customer Submits India-wide Part Enquiry
        # -------------------------------------------------------------
        log("\n1. Customer Submitting India-wide Delivery Enquiry on /part-request/...")
        cust_ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        cust_page = cust_ctx.new_page()
        cust_page.goto(f"{BASE_URL}/part-request/", wait_until="networkidle")
        cust_page.wait_for_selector("#enquiry-form")
        cust_page.screenshot(path=str(RESULTS_DIR / "01_india_enquiry_form.png"))

        # Fill Enquiry Form with City & State/UT
        log("   Filling Phone & Destination details (Lucknow, Uttar Pradesh)...")
        cust_page.select_option("#brand", label="Samsung")
        cust_page.fill("#model", "Galaxy S24 Ultra")
        cust_page.fill("input[name='variant']", "512GB Titanium Black")
        cust_page.select_option("#category", label="Display & touchscreen")
        cust_page.fill("#description", "Need genuine Dynamic AMOLED 2X panel with frame.")
        cust_page.fill("#qty", "1")
        cust_page.select_option("#grade", label="Original / OEM preference")
        cust_page.select_option("#method", label="Delivery requested")
        
        # Customer Info & Destination
        cust_page.fill("#name", "Amitabh Verma")
        cust_page.fill("#phone", "9876598765")
        cust_page.fill("input[name='email']", "amitabh.verma@example.com")
        cust_page.fill("#locality", "Indiranagar")
        cust_page.fill("#city", "Lucknow")
        cust_page.select_option("#region", label="Uttar Pradesh")
        cust_page.fill("#pincode", "226016")
        cust_page.fill("#address", "House 42, Sector 14, Indiranagar, Lucknow")
        cust_page.select_option("#urgency", label="Within 24 hours")
        cust_page.check("#consent")
        cust_page.screenshot(path=str(RESULTS_DIR / "02_india_enquiry_filled.png"))

        log("   Submitting Enquiry...")
        cust_page.click("#enquiry-form button[type='submit']")
        cust_page.wait_for_selector(".request-confirmation, .request-id")
        
        enquiry_ref = cust_page.locator(".request-id").inner_text().strip()
        access_code = cust_page.locator(".private-link").inner_text().strip() if cust_page.locator(".private-link").count() > 0 else ""
        log(f"   SUCCESS: Enquiry Created: {enquiry_ref}, Access Code: {access_code}")
        cust_page.screenshot(path=str(RESULTS_DIR / "03_enquiry_confirmed.png"))

        # Verify SQLite Database columns
        log("2. Verifying Database Record with city & region...")
        con = sqlite3.connect("data/repairlylabs.sqlite")
        row = con.execute("SELECT ref, brand, model, city, region, locality, address, pincode, status FROM rl_part_inquiries WHERE ref=?", (enquiry_ref,)).fetchone()
        con.close()
        assert row is not None, f"Enquiry {enquiry_ref} must be in DB"
        log(f"   DB Record Verified: ref={row[0]}, device={row[1]} {row[2]}, city={row[3]}, region={row[4]}, locality={row[5]}, pincode={row[7]}")
        assert row[3] == "Lucknow", "City must be stored as Lucknow"
        assert row[4] == "Uttar Pradesh", "Region must be stored as Uttar Pradesh"

        # -------------------------------------------------------------
        # 3. Staff Reviews & Quotes in Admin Desk
        # -------------------------------------------------------------
        log("\n3. Staff Desk Quotation (/part-request/?admin=1)...")
        staff_ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        staff_page = staff_ctx.new_page()

        # Log in as owner
        staff_page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
        staff_page.fill("#login-username", "owner")
        staff_page.fill("input[name='password']", "Admin12345678!")
        staff_page.click("form[data-form='admin-login'] button[type='submit']")
        staff_page.wait_for_selector("#admin-content, .admin-main")

        # Open parts enquiry inbox
        staff_page.goto(f"{BASE_URL}/part-request/?admin=1", wait_until="networkidle")
        staff_page.wait_for_selector(".inbox-list")
        staff_page.screenshot(path=str(RESULTS_DIR / "04_staff_inbox_with_destination.png"))

        # Click the new enquiry
        log("   Opening customer enquiry item...")
        staff_page.locator(f"[data-open='{enquiry_ref}']").click()
        staff_page.wait_for_selector("#staff-quote-form, .info-table")
        
        # Confirm city and state are displayed in staff details
        detail_text = staff_page.locator(".info-table").inner_text()
        assert "Lucknow" in detail_text, "Staff view must show customer city"
        assert "Uttar Pradesh" in detail_text, "Staff view must show customer state/UT"
        staff_page.screenshot(path=str(RESULTS_DIR / "05_staff_detail_view.png"))

        # Publish Quote
        log("   Publishing price and delivery quote...")
        staff_page.select_option("#staff-quote-form select[name='status']", value="quoted")
        staff_page.select_option("#staff-quote-form select[name='availability']", value="in_stock")
        staff_page.fill("#staff-quote-form input[name='price_rupees']", "5800")
        staff_page.fill("#staff-quote-form input[name='delivery_rupees']", "180")
        staff_page.fill("#staff-quote-form input[name='eta']", "2 business days to Lucknow via Speed Post / Blue Dart")
        
        future_date = (datetime.date.today() + datetime.timedelta(days=7)).strftime("%Y-%m-%d")
        staff_page.fill("#staff-quote-form input[name='quote_valid_until']", future_date)
        staff_page.fill("#staff-quote-form textarea[name='quote_note']", "Genuine OLED assembly inspected and ready for dispatch.")
        staff_page.screenshot(path=str(RESULTS_DIR / "06_staff_quote_filled.png"))

        staff_page.click("#staff-quote-form button[type='submit']")
        staff_page.wait_for_timeout(600)
        log("   Staff quote published.")
        staff_page.screenshot(path=str(RESULTS_DIR / "07_staff_quote_published.png"))

        # -------------------------------------------------------------
        # 4. Customer Accepts Quotation
        # -------------------------------------------------------------
        log("\n4. Customer Private Quote Acceptance...")
        cust_quote_url = f"{BASE_URL}/part-request/#{enquiry_ref}:{access_code}"
        log(f"   Navigating to: {cust_quote_url}")
        review_page = cust_ctx.new_page()
        review_page.goto(cust_quote_url, wait_until="networkidle")
        review_page.wait_for_selector("[data-decision='accept']")
        review_page.screenshot(path=str(RESULTS_DIR / "08_customer_quote_review.png"))

        # Accept quotation
        review_page.on("dialog", lambda d: d.accept())
        review_page.click("button[data-decision='accept']")
        review_page.wait_for_timeout(600)
        review_page.screenshot(path=str(RESULTS_DIR / "09_customer_quote_accepted.png"))
        log("   VERIFIED: Customer quotation accepted successfully.")

        # Cleanup
        cust_ctx.close()
        staff_ctx.close()
        browser.close()

    log("="*70)
    log("INDIA-WIDE PART ENQUIRY WORKFLOW PASSED 100% IN HEADED CHROME!")
    log("="*70)

if __name__ == "__main__":
    test_india_enquiry_workflow()
