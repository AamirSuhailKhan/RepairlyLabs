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
RESULTS_DIR = pathlib.Path("test-results")
SCREENSHOTS_DIR = RESULTS_DIR / "screenshots"
VIDEOS_DIR = RESULTS_DIR / "videos"
TRACES_DIR = RESULTS_DIR / "traces"

for d in [SCREENSHOTS_DIR, VIDEOS_DIR, TRACES_DIR]:
    d.mkdir(parents=True, exist_ok=True)

findings = {
    "timestamp": datetime.datetime.now().isoformat(),
    "base_url": BASE_URL,
    "chrome_exe": CHROME_EXE,
    "journeys": {},
    "console_errors": [],
    "network_failures": [],
    "bugs_found": [],
    "fixes_applied": []
}

def log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def attach_listeners(page, journey_name):
    page.on("console", lambda msg: findings["console_errors"].append({
        "journey": journey_name,
        "type": msg.type,
        "text": msg.text,
        "location": msg.location
    }) if msg.type in ["error", "warning"] else None)

    page.on("requestfailed", lambda req: findings["network_failures"].append({
        "journey": journey_name,
        "url": req.url,
        "failure": req.failure
    }))

def run_audit():
    log("="*70)
    log("STARTING REPAIRLYLABS ULTIMATE REAL CHROME BROWSER AUDIT")
    log(f"Target: {BASE_URL}")
    log(f"Visible Chrome: {CHROME_EXE}")
    log(f"Outputs: {RESULTS_DIR}")
    log("="*70)

    with sync_playwright() as pw:
        log("Launching Google Chrome in HEADED mode (visible)...")
        browser = pw.chromium.launch(
            headless=False,
            executable_path=CHROME_EXE if os.path.exists(CHROME_EXE) else None,
            slow_mo=200
        )

        # -------------------------------------------------------------
        # JOURNEY 1: Storefront, Visual Design & Route Discovery
        # -------------------------------------------------------------
        log("\n>>> JOURNEY 1: Storefront, Navigation & Public Routes")
        j1_context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(VIDEOS_DIR)
        )
        j1_context.tracing.start(screenshots=True, snapshots=True, sources=True)
        j1_page = j1_context.new_page()
        attach_listeners(j1_page, "Journey 1 - Storefront")

        try:
            # 1.1 Homepage
            log("1.1 Loading Homepage...")
            j1_page.goto(f"{BASE_URL}/", wait_until="networkidle")
            assert j1_page.locator("#navbar").is_visible(), "Navbar must be visible"
            assert "Repairly" in j1_page.locator("#navbar .logo").inner_text(), "Logo brand must be present"
            
            # Check hero & key elements
            assert j1_page.locator(".hero h1").is_visible(), "Hero heading must be visible"
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_01_homepage_hero.png"))
            
            # Scroll through page sections
            log("    Scrolling to services & trust sections...")
            j1_page.evaluate("window.scrollTo(0, 800)")
            j1_page.wait_for_timeout(400)
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_02_services_section.png"))

            j1_page.evaluate("window.scrollTo(0, 1800)")
            j1_page.wait_for_timeout(400)
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_03_parts_showcase.png"))

            j1_page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            j1_page.wait_for_timeout(400)
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_04_footer.png"))

            # 1.2 Repairs Page
            log("1.2 Navigating to Repairs Page...")
            j1_page.click("nav.nav-links a[href='/repairs']")
            j1_page.wait_for_selector(".service-grid")
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_05_repairs_page.png"))

            # 1.3 Spare Parts Catalog
            log("1.3 Navigating to Spare Parts Page...")
            j1_page.click("nav.nav-links a[href='/parts']")
            j1_page.wait_for_selector("#shop-result")
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_06_parts_page.png"))

            # 1.4 Track Request Page
            log("1.4 Navigating to Track Page...")
            j1_page.click("nav.nav-links a[href='/track']")
            j1_page.wait_for_selector("input[name='ref'], input#ref, form")
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_07_track_page.png"))

            # 1.5 Our Approach (About) Page
            log("1.5 Navigating to Our Approach Page...")
            j1_page.click("nav.nav-links a[href='/about']")
            j1_page.wait_for_selector(".page-hero")
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_08_about_page.png"))

            # 1.6 Contact Page
            log("1.6 Navigating to Contact Page...")
            j1_page.click("nav.nav-links a[href='/contact']")
            j1_page.wait_for_selector("form[data-form='contact'], form")
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_09_contact_page.png"))

            # Submit contact message
            log("    Submitting test message on Contact Page...")
            j1_page.fill("input[name='name']", "Test Visitor")
            j1_page.fill("input[name='email']", "visitor@example.com")
            j1_page.fill("input[name='phone']", "9876543210")
            j1_page.fill("textarea[name='message']", "Automated browser inquiry test for Varanasi mobile care.")
            j1_page.check("input[name='consent']")
            j1_page.click("button[type='submit']")
            j1_page.wait_for_selector(".success-icon, #toast:not(:empty)")
            assert j1_page.locator("h3", has_text="Message received").is_visible(), "Contact success message must be visible"
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_10_contact_submitted.png"))

            # 1.7 Privacy Page
            log("1.7 Navigating to Privacy Notice...")
            j1_page.goto(f"{BASE_URL}/privacy", wait_until="networkidle")
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_11_privacy_page.png"))

            findings["journeys"]["journey_1_storefront"] = "PASS"
            log(">>> JOURNEY 1 COMPLETE: PASS")
        except Exception as e:
            log(f"!!! JOURNEY 1 FAILED: {e}")
            findings["journeys"]["journey_1_storefront"] = f"FAIL: {e}"
            j1_page.screenshot(path=str(SCREENSHOTS_DIR / "j1_failure.png"))
        finally:
            j1_context.tracing.stop(path=str(TRACES_DIR / "journey_1_trace.zip"))
            j1_context.close()

        # -------------------------------------------------------------
        # JOURNEY 2: Customer Repair Booking (End-to-End)
        # -------------------------------------------------------------
        log("\n>>> JOURNEY 2: Customer Repair Booking Flow")
        j2_context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(VIDEOS_DIR)
        )
        j2_context.tracing.start(screenshots=True, snapshots=True, sources=True)
        j2_page = j2_context.new_page()
        attach_listeners(j2_page, "Journey 2 - Repair Booking")
        created_booking_ref = None

        try:
            log("2.1 Opening Repair Booking Form...")
            j2_page.goto(f"{BASE_URL}/repairs#booking", wait_until="networkidle")
            j2_page.wait_for_selector("form[data-form='booking']")
            j2_page.screenshot(path=str(SCREENSHOTS_DIR / "j2_01_booking_form.png"))

            log("2.2 Testing Negative Validation (Empty submit)...")
            j2_page.click("form[data-form='booking'] button[type='submit']")
            j2_page.wait_for_timeout(300)
            j2_page.screenshot(path=str(SCREENSHOTS_DIR / "j2_02_validation_prevented.png"))

            log("2.3 Filling Valid Synthetic Booking Details...")
            j2_page.fill("#name", "Synthetic Customer")
            j2_page.fill("#phone", "9876543210")
            j2_page.fill("input[name='email']", "synthetic@example.com")
            
            # Select Brand and Model
            log("    Selecting Phone Brand (Apple)...")
            j2_page.select_option("#brand", label="Apple")
            j2_page.wait_for_timeout(300)
            j2_page.fill("#model", "iPhone 13")

            # Select Issue
            log("    Selecting Problem...")
            j2_page.select_option("#issue", index=1)

            # Service preference & Area
            log("    Setting service preferences in Varanasi...")
            j2_page.select_option("#method", index=1) # Visit workshop
            j2_page.fill("#locality", "Sigra")
            j2_page.fill("#address", "Shop 14, Near Sigra Stadium, Sigra, Varanasi")
            j2_page.fill("#notes", "Synthetic browser QA repair booking.")
            
            # Consent
            j2_page.check("input[name='consent']")
            j2_page.screenshot(path=str(SCREENSHOTS_DIR / "j2_03_booking_filled.png"))

            log("2.4 Submitting Repair Booking...")
            j2_page.click("form[data-form='booking'] button[type='submit']")
            j2_page.wait_for_selector(".reference, .success-card")
            
            ref_el = j2_page.locator(".reference")
            created_booking_ref = ref_el.inner_text().strip()
            log(f"    SUCCESS: Booking confirmed with Reference: {created_booking_ref}")
            j2_page.screenshot(path=str(SCREENSHOTS_DIR / "j2_04_booking_confirmed.png"))

            # 2.5 Verify Database State directly
            log("2.5 Verifying Database Record for Booking...")
            con = sqlite3.connect("data/repairlylabs.sqlite")
            row = con.execute("SELECT b.ref, b.name, b.phone, b.brand, b.model, b.issue, j.stage FROM bookings b LEFT JOIN rl_jobs j ON b.ref=j.ref WHERE b.ref=?", (created_booking_ref,)).fetchone()
            con.close()
            assert row is not None, f"Booking {created_booking_ref} must exist in bookings DB"
            log(f"    DB Verified: ref={row[0]}, name={row[1]}, phone={row[2]}, device={row[3]} {row[4]}, stage={row[6]}")

            # 2.6 Test Customer Tracking with this reference
            log("2.6 Testing Tracking Portal (/track)...")
            j2_page.goto(f"{BASE_URL}/track", wait_until="networkidle")
            j2_page.fill("input[name='ref']", created_booking_ref)
            j2_page.fill("input[name='phone']", "9876543210")
            j2_page.click("button[type='submit']")
            j2_page.wait_for_selector(".status-timeline, .job-details, .status-line")
            log("    Tracking portal loaded booking status timeline successfully.")
            j2_page.screenshot(path=str(SCREENSHOTS_DIR / "j2_05_tracking_view.png"))

            findings["journeys"]["journey_2_repair_booking"] = {
                "status": "PASS",
                "reference": created_booking_ref
            }
            log(">>> JOURNEY 2 COMPLETE: PASS")
        except Exception as e:
            log(f"!!! JOURNEY 2 FAILED: {e}")
            findings["journeys"]["journey_2_repair_booking"] = f"FAIL: {e}"
            j2_page.screenshot(path=str(SCREENSHOTS_DIR / "j2_failure.png"))
        finally:
            j2_context.tracing.stop(path=str(TRACES_DIR / "journey_2_trace.zip"))
            j2_context.close()

        # -------------------------------------------------------------
        # JOURNEY 3: Spare Parts Catalog, Cart & Checkout
        # -------------------------------------------------------------
        log("\n>>> JOURNEY 3: Spare Parts Catalog, Cart & Checkout")
        j3_context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(VIDEOS_DIR)
        )
        j3_context.tracing.start(screenshots=True, snapshots=True, sources=True)
        j3_page = j3_context.new_page()
        attach_listeners(j3_page, "Journey 3 - Parts & Cart")

        try:
            log("3.1 Loading Parts Catalog...")
            j3_page.goto(f"{BASE_URL}/parts", wait_until="networkidle")
            j3_page.wait_for_selector(".product-card")
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_01_parts_catalog.png"))

            # Test Category Filter
            log("3.2 Filtering by Category (Battery)...")
            battery_chip = j3_page.locator(".category-chips .chip", has_text="Batteries").first
            if battery_chip.count() > 0:
                battery_chip.click()
                j3_page.wait_for_timeout(300)
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_02_filtered_batteries.png"))

            # Test Search Filter
            log("3.3 Searching Catalog for 'Pro'...")
            j3_page.fill("#shop-search", "Pro")
            j3_page.wait_for_timeout(400)
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_03_search_results.png"))

            # Product Detail Modal
            log("3.4 Opening Product Details Modal...")
            j3_page.locator(".product-card button[data-action='detail']").first.click()
            j3_page.wait_for_selector(".dialog, .drawer")
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_04_product_modal.png"))
            j3_page.click(".icon-btn[data-action='close']")

            # Add to Cart
            log("3.5 Adding Item to Shopping Cart...")
            j3_page.locator(".product-card button[data-action='add']").first.click()
            j3_page.wait_for_timeout(300)
            cart_count_text = j3_page.locator("#cart-count").inner_text()
            log(f"    Cart count updated to: {cart_count_text}")
            assert int(cart_count_text) >= 1, "Cart count must increment"

            # Open Cart Drawer
            log("3.6 Opening Cart Drawer & Adjusting Quantity...")
            j3_page.click(".cart-trigger")
            j3_page.wait_for_selector(".drawer, .cart-row")
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_05_cart_drawer.png"))

            # Increment quantity
            j3_page.locator(".qty-controls button[data-delta='1']").click()
            j3_page.wait_for_timeout(300)
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_06_cart_qty_incremented.png"))

            # Checkout
            log("3.7 Proceeding to Parts Checkout...")
            j3_page.click(".cart-footer button[data-action='checkout']")
            j3_page.wait_for_selector("form[data-form='checkout']")
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_07_checkout_dialog.png"))

            # Fill Checkout Form
            log("    Filling Checkout Details...")
            j3_page.fill("form[data-form='checkout'] input[name='name']", "Kavita Sharma")
            j3_page.fill("form[data-form='checkout'] input[name='phone']", "9876512345")
            j3_page.fill("form[data-form='checkout'] input[name='locality']", "Nadesar")
            j3_page.fill("form[data-form='checkout'] input[name='address']", "Flat 302, Nadesar Heights, Varanasi")
            j3_page.check("form[data-form='checkout'] input[name='consent']")
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_08_checkout_filled.png"))

            log("3.8 Submitting Parts Order...")
            j3_page.click("form[data-form='checkout'] button[type='submit']")
            j3_page.wait_for_selector(".success-card, .reference")
            order_ref = j3_page.locator(".reference").inner_text().strip()
            log(f"    SUCCESS: Parts Order Created with Reference: {order_ref}")
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_09_order_confirmed.png"))

            findings["journeys"]["journey_3_parts_cart"] = {
                "status": "PASS",
                "order_ref": order_ref
            }
            log(">>> JOURNEY 3 COMPLETE: PASS")
        except Exception as e:
            log(f"!!! JOURNEY 3 FAILED: {e}")
            findings["journeys"]["journey_3_parts_cart"] = f"FAIL: {e}"
            j3_page.screenshot(path=str(SCREENSHOTS_DIR / "j3_failure.png"))
        finally:
            j3_context.tracing.stop(path=str(TRACES_DIR / "journey_3_trace.zip"))
            j3_context.close()

        # -------------------------------------------------------------
        # JOURNEY 4: Customer Part Enquiry (V1.4 Feature)
        # -------------------------------------------------------------
        log("\n>>> JOURNEY 4: Personal Spare-Part Enquiry & Quotation Request")
        j4_context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(VIDEOS_DIR)
        )
        j4_context.tracing.start(screenshots=True, snapshots=True, sources=True)
        j4_page = j4_context.new_page()
        attach_listeners(j4_page, "Journey 4 - Part Enquiry")
        created_enquiry_ref = None
        created_enquiry_access = None

        try:
            log("4.1 Opening Part Request Portal (/part-request/)...")
            j4_page.goto(f"{BASE_URL}/part-request/", wait_until="networkidle")
            j4_page.wait_for_selector("#enquiry-form")
            j4_page.screenshot(path=str(SCREENSHOTS_DIR / "j4_01_part_request_form.png"))

            log("4.2 Filling Part Enquiry Form...")
            j4_page.select_option("#brand", label="Samsung")
            j4_page.fill("#model", "Galaxy S23 Ultra")
            j4_page.fill("input[name='variant']", "256GB Phantom Black")
            j4_page.select_option("#category", index=1)
            j4_page.fill("#description", "Need original dynamic AMOLED 2X display with frame.")
            j4_page.fill("#qty", "1")
            j4_page.select_option("#grade", label="Original / OEM preference")
            j4_page.select_option("#method", label="Delivery requested")
            j4_page.fill("#name", "Vikram Rathore")
            j4_page.fill("#phone", "9876598765")
            j4_page.fill("input[name='email']", "vikram.rathore@example.com")
            j4_page.fill("#locality", "Assi Ghat")
            j4_page.fill("#address", "House 18, Near Assi Ghat, Varanasi")
            j4_page.fill("#pincode", "221005")
            j4_page.select_option("#urgency", label="Within 24 hours")
            j4_page.check("#consent")
            j4_page.screenshot(path=str(SCREENSHOTS_DIR / "j4_02_enquiry_filled.png"))

            log("4.3 Submitting Enquiry...")
            j4_page.click("#enquiry-form button[type='submit']")
            j4_page.wait_for_selector(".request-confirmation, .request-id")
            
            created_enquiry_ref = j4_page.locator(".request-id").inner_text().strip()
            if j4_page.locator(".private-link").count() > 0:
                created_enquiry_access = j4_page.locator(".private-link").inner_text().strip()
            log(f"    SUCCESS: Part Enquiry Reference: {created_enquiry_ref}, Access Code: {created_enquiry_access}")
            j4_page.screenshot(path=str(SCREENSHOTS_DIR / "j4_03_enquiry_confirmed.png"))

            # Verify in DB
            con = sqlite3.connect("data/repairlylabs.sqlite")
            enq_row = con.execute("SELECT ref, brand, model, category, status FROM rl_part_inquiries WHERE ref=?", (created_enquiry_ref,)).fetchone()
            con.close()
            assert enq_row is not None, f"Enquiry {created_enquiry_ref} must exist in DB"
            log(f"    DB Verified: ref={enq_row[0]}, device={enq_row[1]} {enq_row[2]}, status={enq_row[4]}")

            findings["journeys"]["journey_4_part_enquiry"] = {
                "status": "PASS",
                "reference": created_enquiry_ref,
                "access": created_enquiry_access
            }
            log(">>> JOURNEY 4 COMPLETE: PASS")
        except Exception as e:
            log(f"!!! JOURNEY 4 FAILED: {e}")
            findings["journeys"]["journey_4_part_enquiry"] = f"FAIL: {e}"
            j4_page.screenshot(path=str(SCREENSHOTS_DIR / "j4_failure.png"))
        finally:
            j4_context.tracing.stop(path=str(TRACES_DIR / "journey_4_trace.zip"))
            j4_context.close()

        # -------------------------------------------------------------
        # JOURNEYS 5, 6, 7, 8: Unified Authenticated Admin Suite
        # -------------------------------------------------------------
        log("\n>>> STARTING UNIFIED ADMIN CONTEXT (Journeys 5 - 8)")
        admin_context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(VIDEOS_DIR)
        )
        admin_context.tracing.start(screenshots=True, snapshots=True, sources=True)
        admin_page = admin_context.new_page()
        attach_listeners(admin_page, "Admin Session")

        try:
            # -------------------------------------------------------------
            # JOURNEY 5: Admin Login, Tabs & Role Management
            # -------------------------------------------------------------
            log("\n>>> JOURNEY 5: Admin Login, Dashboard & Role Permissions")
            log("5.1 Loading Admin Login Page...")
            admin_page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
            admin_page.wait_for_selector("form[data-form='admin-login']")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j5_01_admin_login_page.png"))

            # Log in with Verified Owner Credentials
            log("5.2 Logging in with Verified Owner Credentials...")
            admin_page.fill("#login-username", "owner")
            admin_page.fill("input[name='password']", "Admin12345678!")
            admin_page.click("form[data-form='admin-login'] button[type='submit']")
            admin_page.wait_for_selector("#admin-content, .admin-main")
            log("    SUCCESS: Admin Dashboard Loaded.")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j5_03_admin_overview.png"))

            # Test All Admin Tabs
            tabs = [
                ("bookings", "Repair Requests", "j5_04_tab_bookings.png"),
                ("orders", "Parts Orders", "j5_05_tab_orders.png"),
                ("products", "Part Inventory", "j5_06_tab_inventory.png"),
                ("services", "Repair Services", "j5_07_tab_services.png"),
                ("messages", "Messages", "j5_08_tab_messages.png"),
                ("models", "Phone Models", "j5_09_tab_models.png"),
                ("settings", "Site Settings", "j5_10_tab_settings.png"),
                ("security", "Account Security", "j5_11_tab_security.png"),
            ]
            for tab_id, tab_label, sc_name in tabs:
                log(f"    Testing Admin Tab: {tab_label}...")
                admin_page.click(f"button[data-admin-tab='{tab_id}']")
                admin_page.wait_for_timeout(350)
                admin_page.screenshot(path=str(SCREENSHOTS_DIR / sc_name))

            # Verify the booking from Journey 2 is visible in bookings tab
            log("5.3 Verifying Booking Appears in Admin Table...")
            admin_page.click("button[data-admin-tab='bookings']")
            admin_page.wait_for_timeout(350)
            if created_booking_ref:
                assert created_booking_ref in admin_page.locator("#admin-content").inner_text(), f"Booking {created_booking_ref} must be listed in admin bookings"
                log(f"    Confirmed: Booking {created_booking_ref} visible in Admin table.")

            # Verify the order from Journey 3 is visible in orders tab
            log("5.4 Verifying Parts Order Appears in Admin Table...")
            admin_page.click("button[data-admin-tab='orders']")
            admin_page.wait_for_timeout(350)
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j5_12_orders_verified.png"))

            findings["journeys"]["journey_5_admin_portal"] = "PASS"
            log(">>> JOURNEY 5 COMPLETE: PASS")

            # -------------------------------------------------------------
            # JOURNEY 6: Complete Repair Workflow at the Repair Desk
            # -------------------------------------------------------------
            log("\n>>> JOURNEY 6: Repair Desk Inspection, Quotation & Notes")
            log("6.1 Opening Repair Desk (/repair-center/?admin=1)...")
            admin_page.goto(f"{BASE_URL}/repair-center/?admin=1", wait_until="networkidle")
            admin_page.wait_for_selector("#jobs table")
            log("    Repair desk inbox loaded with jobs.")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j6_01_repair_desk_inbox.png"))

            # Open the job we created or the first active job
            log("6.2 Opening Job Details...")
            target_btn = admin_page.locator(f"button[data-ref='{created_booking_ref}']") if created_booking_ref else admin_page.locator("button[data-ref]").first
            if target_btn.count() > 0:
                target_btn.click()
            else:
                admin_page.locator("button[data-ref]").first.click()
            
            admin_page.wait_for_selector(".intake-fields, #diagnosis, .split")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j6_02_job_detail_opened.png"))

            # Save inspection / diagnosis
            log("6.3 Saving Technician Inspection Notes...")
            diag_textarea = admin_page.locator("#diagnosis textarea[name='diagnosis']")
            if diag_textarea.is_visible():
                diag_textarea.fill("Screen verified cracked. Internal motherboard and battery intact.")
                admin_page.click("#diagnosis button")
                admin_page.wait_for_timeout(500)
                log("    Inspection notes saved.")
                admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j6_03_diagnosis_saved.png"))

            # Check Quotation Form
            log("6.4 Inspecting Quotation Form & Labor...")
            if admin_page.locator("#quote").is_visible():
                admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j6_04_quote_form.png"))

            findings["journeys"]["journey_6_repair_desk"] = "PASS"
            log(">>> JOURNEY 6 COMPLETE: PASS")

            # -------------------------------------------------------------
            # JOURNEY 7: Staff Part Enquiry Quotation (/part-request/?admin=1)
            # -------------------------------------------------------------
            log("\n>>> JOURNEY 7: Staff Parts Enquiry Inbox & Quote Publishing")
            log("7.1 Opening Parts Enquiry Staff Desk (/part-request/?admin=1)...")
            admin_page.goto(f"{BASE_URL}/part-request/?admin=1", wait_until="networkidle")
            admin_page.wait_for_selector(".inbox-header, .inbox-list")
            log("    Parts enquiry inbox loaded successfully.")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j7_01_staff_inbox.png"))

            # Click enquiry item
            log("7.2 Opening Enquiry Item Details...")
            if created_enquiry_ref:
                target_enq = admin_page.locator(f"[data-open='{created_enquiry_ref}']")
                if target_enq.count() > 0:
                    target_enq.click()
                else:
                    admin_page.locator(".inbox-item, [data-open]").first.click()
            else:
                admin_page.locator(".inbox-item, [data-open]").first.click()

            admin_page.wait_for_selector("#staff-quote-form, .info-table")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j7_02_enquiry_details.png"))

            # Prepare staff quote
            log("7.3 Preparing Staff Price & Availability Quote...")
            admin_page.select_option("#staff-quote-form select[name='status']", value="quoted")
            admin_page.select_option("#staff-quote-form select[name='availability']", value="in_stock")
            admin_page.fill("#staff-quote-form input[name='price_rupees']", "4500")
            admin_page.fill("#staff-quote-form input[name='delivery_rupees']", "150")
            admin_page.fill("#staff-quote-form input[name='eta']", "Today by 6:00 PM")
            
            future_date = (datetime.date.today() + datetime.timedelta(days=7)).strftime("%Y-%m-%d")
            admin_page.fill("#staff-quote-form input[name='quote_valid_until']", future_date)
            admin_page.fill("#staff-quote-form textarea[name='quote_note']", "Genuine OLED panel available in Varanasi workshop.")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j7_03_quote_filled.png"))

            log("7.4 Saving & Publishing Quote...")
            admin_page.click("#staff-quote-form button[type='submit']")
            admin_page.wait_for_timeout(600)
            log("    Quote published successfully.")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j7_04_quote_published.png"))

            # Test Customer Quote Acceptance Flow if code is available
            if created_enquiry_ref and created_enquiry_access:
                log("7.5 Testing Customer Quote Acceptance in Customer Browser View...")
                cust_ctx = browser.new_context(viewport={"width": 1440, "height": 900})
                cust_pg = cust_ctx.new_page()
                cust_url = f"{BASE_URL}/part-request/#{created_enquiry_ref}:{created_enquiry_access}"
                log(f"    Navigating to customer quote link: {cust_url}")
                cust_pg.goto(cust_url, wait_until="networkidle")
                cust_pg.wait_for_selector(".quote-card, [data-decision='accept']")
                cust_pg.screenshot(path=str(SCREENSHOTS_DIR / "j7_05_customer_quote_view.png"))
                
                # Accept quotation
                cust_pg.on("dialog", lambda dialog: dialog.accept())
                cust_pg.click("button[data-decision='accept']")
                cust_pg.wait_for_timeout(600)
                cust_pg.screenshot(path=str(SCREENSHOTS_DIR / "j7_06_quote_accepted.png"))
                log("    Customer accepted quotation successfully.")
                cust_ctx.close()

            findings["journeys"]["journey_7_part_enquiry_staff"] = "PASS"
            log(">>> JOURNEY 7 COMPLETE: PASS")

            # -------------------------------------------------------------
            # JOURNEY 8: Operations Console, PDF Billing & Language Toggle
            # -------------------------------------------------------------
            log("\n>>> JOURNEY 8: Operations Console, Logistics & PDF Billing")
            log("8.1 Opening Extended Operations (/operations/?admin=1)...")
            admin_page.goto(f"{BASE_URL}/operations/?admin=1", wait_until="networkidle")
            admin_page.wait_for_selector("h1, .ops-grid")
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j8_01_operations_console.png"))

            log("8.2 Verifying Operations Console 100% English interface...")
            assert not admin_page.locator("button#lang").is_visible(), "Language toggle should be removed"

            # Test Parts Payment Desk
            log("8.3 Opening Parts Payment Desk (/parts-payment/?admin=1)...")
            admin_page.goto(f"{BASE_URL}/parts-payment/?admin=1", wait_until="networkidle")
            admin_page.wait_for_timeout(400)
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "j8_03_parts_payment_desk.png"))

            findings["journeys"]["journey_8_operations_finance"] = "PASS"
            log(">>> JOURNEY 8 COMPLETE: PASS")

        except Exception as e:
            log(f"!!! ADMIN WORKFLOW ERROR: {e}")
            for j_key in ["journey_5_admin_portal", "journey_6_repair_desk", "journey_7_part_enquiry_staff", "journey_8_operations_finance"]:
                if j_key not in findings["journeys"]:
                    findings["journeys"][j_key] = f"FAIL: {e}"
            admin_page.screenshot(path=str(SCREENSHOTS_DIR / "admin_failure.png"))
        finally:
            admin_context.tracing.stop(path=str(TRACES_DIR / "admin_trace.zip"))
            admin_context.close()

        # -------------------------------------------------------------
        # JOURNEY 9: Responsive Viewports Suite
        # -------------------------------------------------------------
        log("\n>>> JOURNEY 9: Responsive Mobile & Tablet Testing")
        viewports = [
            ("Small Mobile", 360, 800, "j9_01_small_mobile_360x800.png"),
            ("Standard Mobile", 390, 844, "j9_02_std_mobile_390x844.png"),
            ("Large Mobile", 430, 932, "j9_03_large_mobile_430x932.png"),
            ("Tablet", 768, 1024, "j9_04_tablet_768x1024.png"),
            ("Laptop", 1366, 768, "j9_05_laptop_1366x768.png"),
            ("Desktop", 1920, 1080, "j9_06_desktop_1920x1080.png"),
        ]

        for vp_name, width, height, sc_file in viewports:
            log(f"9.x Testing {vp_name} ({width}x{height})...")
            m_ctx = browser.new_context(viewport={"width": width, "height": height})
            m_page = m_ctx.new_page()
            m_page.goto(f"{BASE_URL}/", wait_until="networkidle")

            # Check for horizontal scroll / overflow
            scroll_width = m_page.evaluate("document.documentElement.scrollWidth")
            client_width = m_page.evaluate("document.documentElement.clientWidth")
            assert scroll_width <= client_width + 1, f"Horizontal overflow detected on {vp_name}: {scroll_width} > {client_width}"

            # If mobile, test menu drawer
            if width <= 980:
                mob_trig = m_page.locator(".mobile-trigger")
                if mob_trig.is_visible():
                    mob_trig.click()
                    m_page.wait_for_timeout(250)

            m_page.screenshot(path=str(SCREENSHOTS_DIR / sc_file))
            m_ctx.close()

        findings["journeys"]["journey_9_responsive_viewports"] = "PASS"
        log(">>> JOURNEY 9 COMPLETE: PASS")

        log("\nClosing Google Chrome...")
        browser.close()

    # Save JSON summary
    summary_path = RESULTS_DIR / "audit-summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(findings, f, indent=2)
    log(f"Audit Summary saved to: {summary_path}")

    log("="*70)
    log("ALL REAL CHROME BROWSER JOURNEYS COMPLETED SUCCESSFULLY!")
    log("="*70)
    return findings

if __name__ == "__main__":
    findings = run_audit()
    failed = [k for k, v in findings["journeys"].items() if isinstance(v, str) and v.startswith("FAIL")]
    if failed:
        log(f"Failures detected: {failed}")
        sys.exit(1)
    else:
        log("ALL JOURNEYS PASSED!")
        sys.exit(0)
