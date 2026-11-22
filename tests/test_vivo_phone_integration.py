import os
import sys
import time
import json
import sqlite3
import shutil
import random
import pathlib
from playwright.sync_api import sync_playwright

CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE_URL = "http://127.0.0.1:3001"
RESULTS_DIR = pathlib.Path("test-results/screenshots/vivo")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR = pathlib.Path(r"C:\Users\aamir\.gemini\antigravity\brain\91966b9b-208f-45ae-bf1a-fe485f2fc307")

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def copy_to_artifacts(src_path, dst_name):
    if ARTIFACTS_DIR.exists():
        dst = ARTIFACTS_DIR / dst_name
        shutil.copy2(src_path, dst)
        log(f"   Copied artifact: {dst_name}")

def test_vivo_integration():
    log("="*70)
    log("TESTING VIVO PHONE INTEGRATION ACROSS REPAIRLYLABS IN REAL HEADED CHROME")
    log("="*70)

    # 10-digit Indian mobile numbers starting with 98 / 97
    rand_suffix1 = random.randint(10000000, 99999999)
    rand_suffix2 = random.randint(10000000, 99999999)
    test_phone_booking = f"98{rand_suffix1}"
    test_phone_enquiry = f"97{rand_suffix2}"

    with sync_playwright() as pw:
        log("Launching Google Chrome (headed mode)...")
        browser = pw.chromium.launch(
            headless=False,
            executable_path=CHROME_EXE if os.path.exists(CHROME_EXE) else None,
            slow_mo=200
        )

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        page.on("console", lambda msg: log(f"   [BROWSER CONSOLE] {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: log(f"   [BROWSER ERROR] {err}"))

        # -------------------------------------------------------------
        # 1. Homepage: Marquee brand strip contains Vivo
        # -------------------------------------------------------------
        log("\n1. Verifying Homepage Brand Strip for Vivo...")
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        page.wait_for_selector(".brand-strip")
        
        brand_words = page.locator(".brand-word").all_inner_texts()
        assert any("vivo" in b.lower() for b in brand_words), f"Vivo not found in brand strip! Found: {brand_words[:10]}"
        log(f"   PASS: 'Vivo' found in homepage brand marquee! (Sample brands: {', '.join(brand_words[:6])})")
        
        home_shot = RESULTS_DIR / "01_homepage_vivo_brand_strip.png"
        page.screenshot(path=str(home_shot))
        copy_to_artifacts(home_shot, "vivo_01_homepage_brand_strip.png")

        # -------------------------------------------------------------
        # 2. Repair Booking: Vivo brand & model population
        # -------------------------------------------------------------
        log("\n2. Verifying Repair Booking for Vivo...")
        page.goto(f"{BASE_URL}/repairs#booking", wait_until="networkidle")
        page.wait_for_selector("#booking-form")

        # Check Vivo option exists in brand select
        brand_select = page.locator("#brand")
        options = brand_select.locator("option").all_inner_texts()
        assert "Vivo" in options, f"Vivo not in brand select options! Found: {options[:8]}"
        log("   PASS: 'Vivo' is in the repair booking brand select options.")

        # Select Vivo and trigger change
        log("   Selecting 'Vivo' as phone brand...")
        page.select_option("#brand", label="Vivo")
        page.wait_for_timeout(600)  # wait for datalist update

        # Check model datalist
        model_datalist_options = page.locator("#model-options option").evaluate_all(
            "options => options.map(o => o.value)"
        )
        assert len(model_datalist_options) > 0, "No Vivo models populated in #model-options datalist!"
        log(f"   PASS: {len(model_datalist_options)} Vivo models loaded in datalist! (e.g. {model_datalist_options[:5]})")
        
        # Verify specific popular Vivo models exist
        for expected in ["Vivo V40", "Vivo X200 Pro", "Vivo T3 5G", "Vivo Y200"]:
            assert any(expected.lower() in m.lower() for m in model_datalist_options), f"Expected model {expected} not found in datalist!"
            log(f"   PASS: Confirmed {expected} is available for repair booking.")

        # Fill Repair Booking Form for Vivo V40 Pro
        log(f"   Submitting test repair booking for Vivo V40 Pro (Phone: {test_phone_booking})...")
        page.fill("#name", "Rohan Vivo Customer")
        page.fill("#phone", test_phone_booking)
        page.fill("#model", "Vivo V40 Pro")
        page.select_option("#issue", index=1)
        page.select_option("#method", index=1)
        page.fill("#locality", "Sigra")
        page.check("input[name='consent']")

        booking_shot = RESULTS_DIR / "02_repair_booking_vivo_v40.png"
        page.screenshot(path=str(booking_shot))
        copy_to_artifacts(booking_shot, "vivo_02_repair_booking_v40.png")

        page.click("#booking-form button[type='submit']")
        page.wait_for_selector(".success-card", timeout=8000)
        
        booking_ref = page.locator(".reference").inner_text().strip()
        log(f"   PASS: Repair booking created successfully! Reference: {booking_ref}")
        assert booking_ref.startswith("RLM-"), f"Unexpected reference format: {booking_ref}"

        success_shot = RESULTS_DIR / "03_repair_booking_success.png"
        page.screenshot(path=str(success_shot))
        copy_to_artifacts(success_shot, "vivo_03_repair_booking_success.png")

        # -------------------------------------------------------------
        # 3. India-wide Part Request: Vivo brand & model population
        # -------------------------------------------------------------
        log("\n3. Verifying India-wide Part Request for Vivo (/part-request/)...")
        page.goto(f"{BASE_URL}/part-request/", wait_until="networkidle")
        page.wait_for_selector("#enquiry-form")

        part_brand_select = page.locator("#brand")
        part_options = part_brand_select.locator("option").all_inner_texts()
        assert "Vivo" in part_options, f"Vivo not in part-request brand select! Found: {part_options[:8]}"
        log("   PASS: 'Vivo' is available in part enquiry brand options.")

        # Select Vivo and check model datalist
        page.select_option("#brand", label="Vivo")
        page.wait_for_timeout(600)

        part_datalist = page.locator("#model-list option").evaluate_all(
            "options => options.map(o => o.value)"
        )
        assert len(part_datalist) > 0, "No Vivo models populated in #model-list datalist!"
        log(f"   PASS: {len(part_datalist)} Vivo models loaded in part-request datalist! (e.g. {part_datalist[:5]})")

        # Fill part enquiry
        log(f"   Submitting part enquiry for Vivo X100 Pro Display (Phone: {test_phone_enquiry})...")
        page.fill("#model", "Vivo X100 Pro")
        page.fill("input[name='variant']", "16GB+512GB Sunset Orange")
        page.select_option("#category", label="Display & touchscreen")
        page.fill("#description", "Need original curved AMOLED screen replacement with frame.")
        page.fill("#name", "Vikram Vivo Part Buyer")
        page.fill("#phone", test_phone_enquiry)
        page.fill("#locality", "Gomti Nagar")
        page.fill("#city", "Lucknow")
        page.select_option("#region", label="Uttar Pradesh")
        page.select_option("#method", label="Delivery requested")
        page.fill("#pincode", "226010")
        page.fill("#address", "Flat 402, Shalimar Heights, Gomti Nagar Extension")
        page.check("#consent")

        enquiry_form_shot = RESULTS_DIR / "04_part_enquiry_vivo_x100.png"
        page.screenshot(path=str(enquiry_form_shot))
        copy_to_artifacts(enquiry_form_shot, "vivo_04_part_enquiry_x100.png")

        page.click("#submit-enquiry")
        page.wait_for_selector(".request-confirmation", timeout=8000)

        enquiry_ref = page.locator(".request-id").inner_text().strip()
        log(f"   PASS: Part enquiry submitted successfully! Reference: {enquiry_ref}")
        assert enquiry_ref.startswith("RLI-") or enquiry_ref.startswith("RLP-"), f"Unexpected enquiry ref: {enquiry_ref}"

        enquiry_success_shot = RESULTS_DIR / "05_part_enquiry_success.png"
        page.screenshot(path=str(enquiry_success_shot))
        copy_to_artifacts(enquiry_success_shot, "vivo_05_part_enquiry_success.png")

        # -------------------------------------------------------------
        # 4. Database Verification
        # -------------------------------------------------------------
        log("\n4. Verifying SQLite Database Records...")
        conn = sqlite3.connect("data/repairlylabs.sqlite")
        cur = conn.cursor()

        # Check booking
        cur.execute("SELECT ref, brand, model, name, phone FROM bookings WHERE ref = ?", (booking_ref,))
        b_row = cur.fetchone()
        assert b_row is not None, f"Booking {booking_ref} not found in database!"
        assert b_row[1] == "Vivo", f"Expected brand 'Vivo', got '{b_row[1]}'"
        assert "V40" in b_row[2], f"Expected model 'Vivo V40 Pro', got '{b_row[2]}'"
        log(f"   PASS: Database confirmed booking {booking_ref}: Brand={b_row[1]}, Model={b_row[2]}, Customer={b_row[3]}")

        # Check part enquiry
        cur.execute("SELECT ref, brand, model, name, city FROM rl_part_inquiries WHERE ref = ?", (enquiry_ref,))
        p_row = cur.fetchone()
        assert p_row is not None, f"Enquiry {enquiry_ref} not found in database!"
        assert p_row[1] == "Vivo", f"Expected brand 'Vivo', got '{p_row[1]}'"
        assert "X100" in p_row[2], f"Expected model 'Vivo X100 Pro', got '{p_row[2]}'"
        log(f"   PASS: Database confirmed enquiry {enquiry_ref}: Brand={p_row[1]}, Model={p_row[2]}, Customer={p_row[3]}, City={p_row[4]}")

        conn.close()

        log("\n" + "="*70)
        log("ALL VIVO PHONE INTEGRATION & CHROME TESTS PASSED WITH 100% SUCCESS!")
        log("="*70)

        browser.close()

if __name__ == "__main__":
    test_vivo_integration()
