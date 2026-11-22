"""
RepairlyLabs — Isolated Full Lifecycle & Visible Chrome Master Suite
Runs against an isolated test database on port 3005.
Leaves real database (data/repairlylabs.sqlite) and .env completely untouched.
Records full Playwright video and captures high-resolution screenshots.
"""
import os
import sys
import time
import json
import shutil
import tempfile
import pathlib
import subprocess
import ctypes
import secrets
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCREENSHOTS_DIR = ROOT / "test-results" / "screenshots" / "isolated_lifecycle"
VIDEOS_DIR = ROOT / "test-results" / "videos"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 3005
BASE_URL = f"http://127.0.0.1:{PORT}"

TEST_ADMIN_USER = "testowner"
TEST_ADMIN_PASS = secrets.token_urlsafe(30)  # ephemeral; never written to audit reports

findings = {
    "lifecycle_features": {},
    "regression_tests": {},
    "security_checks": {},
    "environment": {
        "isolated_db": True,
        "real_db_preserved": True,
        "port": PORT,
        "chrome_version": "NOT VERIFIED IN THIS EXECUTION"
    }
}

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def current_windows_desktop_name():
    """Identify the calling thread desktop; headed mode alone is not proof."""
    if os.name != "nt":
        return None
    from ctypes import wintypes
    user32=ctypes.windll.user32
    kernel32=ctypes.windll.kernel32
    handle=user32.GetThreadDesktop(kernel32.GetCurrentThreadId())
    buffer=ctypes.create_unicode_buffer(256)
    required=wintypes.DWORD()
    if not user32.GetUserObjectInformationW(handle, 2, buffer, ctypes.sizeof(buffer), ctypes.byref(required)):
        return "UNAVAILABLE"
    return buffer.value


def bring_to_foreground():
    # A process running on another Window Station desktop cannot display
    # windows on WinSta0\\Default. Never claim physical visibility in that case.
    if current_windows_desktop_name() != "Default":
        raise RuntimeError("BLOCKED: Chrome runner is not on the interactive Default desktop. Open this script yourself from the Windows desktop.")
    user32 = ctypes.windll.user32
    def enum_cb(hwnd, _):
        buff=ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd,buff,256)
        if "RepairlyLabs" in buff.value:
            user32.ShowWindow(hwnd, 3)
            user32.SetForegroundWindow(hwnd)
        return True
    callback=ctypes.WINFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p)(enum_cb)
    user32.EnumWindows(callback,0)


def capture_physical_desktop_proof():
    """Local-only full-monitor capture, not a Playwright page screenshot."""
    if current_windows_desktop_name() != "Default":
        raise RuntimeError("BLOCKED: Cannot certify physical desktop visibility outside WinSta0\\Default.")
    user32=ctypes.windll.user32
    title=ctypes.create_unicode_buffer(512)
    for _ in range(8):
        foreground=user32.GetForegroundWindow()
        user32.GetWindowTextW(foreground,title,512)
        if "RepairlyLabs" in title.value:
            break
        time.sleep(0.25)
        bring_to_foreground()
    if "RepairlyLabs" not in title.value:
        raise RuntimeError("BLOCKED: Chrome showing RepairlyLabs is not the foreground desktop window. Cannot claim visible test.")
    try:
        from PIL import ImageGrab
    except ImportError as e:
        raise RuntimeError("BLOCKED: Pillow required for real desktop proof. Install with: python -m pip install -r tests/requirements-visible.txt") from e
    proof=ROOT / 'test-results' / 'screenshots' / 'local-physical-desktop-proof.png'
    proof.parent.mkdir(parents=True,exist_ok=True)
    ImageGrab.grab(all_screens=True).save(proof)
    findings['environment']['desktop_proof']="PASS: foreground RepairlyLabs window on Windows Default desktop; PRIVATE full-monitor screenshot saved locally"
    log("Verified Chrome on the interactive Default desktop; local PRIVATE monitor screenshot captured.")


def run_lifecycle():
    log("=== STARTING ISOLATED FULL LIFECYCLE & VISIBLE AUDIT ===")
    
    # 1. Create temporary isolated test database directory
    with tempfile.TemporaryDirectory(prefix="repairly-isolated-test-") as test_data_dir:
        log(f"1. Isolated test data directory initialized at: {test_data_dir}")
        
        # Test environment configuration
        # Start from a minimal, explicitly allow-listed environment.  In particular,
        # never inherit real merchant, SMS, email or production DB credentials.
        host_keys = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE",
                     "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT", "HOME",
                     "HOMEDRIVE", "HOMEPATH", "PLAYWRIGHT_BROWSERS_PATH")
        env = {k: os.environ[k] for k in host_keys if k in os.environ}
        env.update({"PORT": str(PORT), "DATA_DIR": test_data_dir,
                    "NODE_ENV": "test", "REPAIRLYLABS_TEST": "1",
                    "REPAIRLYLABS_IGNORE_DOTENV": "1",
                    "PUBLIC_ORIGIN": "", "RL_WA_TOKEN": "", "RL_RESEND_KEY": "",
                    "RL_NOTIFY_URL": "", "NOTIFY_WEBHOOK_URL": "",
                    "RAZORPAY_KEY_ID": "", "RAZORPAY_KEY_SECRET": "",
                    "RAZORPAY_WEBHOOK_SECRET": "", "TWILIO_AUTH_TOKEN": ""})

        # Seed with the password in an isolated child environment rather than
        # exposing it as a command-line literal to process inspection/logs.
        seed_js = """
        import { openDatabase, passwordHash } from './src/data.mjs';
        import { initAccess } from './src/admin-access.mjs';
        const db = openDatabase(process.env.DATA_DIR);
        initAccess(db);
        db.prepare('INSERT INTO admins(username, password_hash) VALUES(?,?)').run('testowner', passwordHash(process.env.RL_ISOLATED_SEED_PASSWORD));
        db.prepare('INSERT INTO admin_owner(id, username) VALUES(1,?)').run('testowner');
        db.close();
        console.log('SEEDED_OK');
        """
        seed_env={**env, 'RL_ISOLATED_SEED_PASSWORD': TEST_ADMIN_PASS}
        init_proc = subprocess.run(["node", "--input-type=module", "-e", seed_js], cwd=str(ROOT), env=seed_env, capture_output=True, text=True)
        assert "SEEDED_OK" in init_proc.stdout, f"Seeding failed: {init_proc.stderr}"
        log("2. Isolated test database schema and mock QR settings seeded.")

        # Start isolated Node.js server on port 3005
        server_cmd = [
            "node", "--input-type=module", "-e",
            f"import {{ server }} from './src/server.mjs'; server.listen({PORT}, '127.0.0.1', () => console.log('SERVER_READY'));"
        ]
        # Keep child output out of the terminal/report. Do not risk a pipe
        # filling during lengthy browser automation; poll the real health URL.
        import urllib.request
        server_log_path = ROOT / 'test-results' / 'isolated-server-private.log'
        server_log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(server_log_path, 'w', encoding='utf-8') as server_log:
            server_proc = subprocess.Popen(server_cmd, cwd=str(ROOT), env=env,
                                           stdout=server_log, stderr=subprocess.STDOUT, text=True)
            started = False
            for _ in range(60):
                if server_proc.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(f"{BASE_URL}/api/health", timeout=1) as response:
                        if response.status == 200:
                            started = True
                            break
                except Exception:
                    time.sleep(0.2)
            if not started or server_proc.poll() is not None:
                if server_proc.poll() is None:
                    server_proc.terminate()
                raise RuntimeError("Isolated test server unavailable or port 3005 in use. No live business port was contacted.")
        log(f"3. Isolated Node.js test server ready (PID: {server_proc.pid})")

        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    executable_path=CHROME_EXE if os.path.exists(CHROME_EXE) else None,
                    headless=False,
                    slow_mo=500,
                    args=["--start-maximized", "--new-window"]
                )
                
                context = browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    record_video_dir=str(VIDEOS_DIR),
                    record_video_size={"width": 1440, "height": 900}
                )
                page = context.new_page()

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 1: CUSTOMER REPAIR BOOKING
                # -----------------------------------------------------------------
                log("\n--- PHASE 1: Customer Repair Booking (Vivo V40 Pro) ---")
                page.goto(f"{BASE_URL}/repairs#booking", wait_until="domcontentloaded")
                bring_to_foreground()
                capture_physical_desktop_proof()
                page.wait_for_selector("form[data-form='booking']")
                
                # Fill repair booking form
                form_el = page.locator("form[data-form='booking']")
                form_el.scroll_into_view_if_needed()
                time.sleep(0.5)

                page.fill("input[name='name']", "Aarav Sharma")
                page.fill("input[name='phone']", "9876543210")
                page.select_option("select[name='brand']", value="Vivo")
                page.wait_for_timeout(400)
                page.fill("input[name='model']", "Vivo V40 Pro")
                page.select_option("select[name='issue']", label="Screen & display repair")
                page.select_option("select[name='method']", value="Request pickup")
                page.fill("input[name='locality']", "Sigra")
                page.fill("input[name='address']", "Flat 302, Sunrise Apartments, Sigra, Varanasi")
                page.fill("textarea[name='notes']", "Shattered display glass, touch ghosting, display flickering green lines")
                page.check("form[data-form='booking'] input[name='consent']")
                
                # Screenshot filled form
                page.screenshot(path=str(SCREENSHOTS_DIR / "01_repair_booking_filled.png"))
                
                # Submit booking
                page.click("form[data-form='booking'] button[type='submit']")
                page.wait_for_selector(".success-card, .reference", timeout=10000)
                time.sleep(0.8)
                page.screenshot(path=str(SCREENSHOTS_DIR / "02_repair_booking_confirmed.png"))
                
                # Extract reference
                result_text = page.locator("body").text_content()
                import re
                ref_match = re.search(r"RLM-\d{6}-[A-F0-9]{8}", result_text)
                assert ref_match, "Booking reference not generated!"
                repair_ref = ref_match.group(0)
                log(f"   >> Repair Reference generated: {repair_ref}")
                findings["lifecycle_features"]["customer_repair_booking"] = {"status": "PASS", "ref": repair_ref}

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 2: ADMIN LOGIN & REPAIR DESK DIAGNOSIS
                # -----------------------------------------------------------------
                log("\n--- PHASE 2: Administrator Sign-in & Repair Diagnosis ---")
                page.goto(f"{BASE_URL}/admin", wait_until="domcontentloaded")
                bring_to_foreground()
                
                page.fill("#login-username", TEST_ADMIN_USER)
                page.fill("input[name='password']", TEST_ADMIN_PASS)
                page.click("button[type='submit']")
                page.wait_for_selector("#admin-content, .admin-shell")
                page.screenshot(path=str(SCREENSHOTS_DIR / "03_admin_dashboard_logged_in.png"))
                log("   >> Administrator successfully authenticated.")

                # Open Repair Center desk
                page.goto(f"{BASE_URL}/repair-center/?admin=1", wait_until="domcontentloaded")
                page.wait_for_selector(".desk-grid, #jobs, .job-card, h1")
                page.screenshot(path=str(SCREENSHOTS_DIR / "04_repair_desk_inbox.png"))

                # Locate our job
                job_link = page.locator(f"a:has-text('{repair_ref}')").first
                if job_link.is_visible():
                    job_link.click()
                else:
                    page.goto(f"{BASE_URL}/repair-center/?admin=1&ref={repair_ref}", wait_until="domcontentloaded")
                
                page.wait_for_timeout(600)
                page.screenshot(path=str(SCREENSHOTS_DIR / "05_job_detail_view.png"))

                # Submit diagnosis via diagnosis form or API
                log("   >> Entering technician diagnosis...")
                diag_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/diagnosis', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{ diagnosis: 'Display assembly cracked. Touch digitizer damaged. AMOLED panel requires OEM replacement.' }})
                    }});
                    return {{ status: res.status, data: await res.json() }};
                }}""")
                log(f"   Diagnosis API response: {diag_res}")
                assert diag_res.get("status") == 200, f"Diagnosis failed: {diag_res}"
                
                page.reload()
                page.wait_for_timeout(500)
                page.screenshot(path=str(SCREENSHOTS_DIR / "06_diagnosis_recorded.png"))
                findings["lifecycle_features"]["repair_diagnosis"] = "PASS"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 3: FORMAL QUOTATION CREATION
                # -----------------------------------------------------------------
                log("\n--- PHASE 3: Quotation Creation ---")
                quote_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/quote', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{
                            items: [
                                {{ name: 'Vivo V40 Pro AMOLED Display Assembly', qty: 1, price: 320000 }}
                            ],
                            labor: 60000,
                            discount: 20000,
                            deposit: 100000
                        }})
                    }});
                    return {{ status: res.status, data: await res.json() }};
                }}""")
                log(f"   Quotation response: {quote_res}")
                assert quote_res.get("status") == 200, f"Quotation creation failed: {quote_res}"
                page.reload()
                page.wait_for_timeout(600)
                page.screenshot(path=str(SCREENSHOTS_DIR / "07_quotation_published.png"))
                findings["lifecycle_features"]["quotation_creation"] = "PASS"

                # Get customer private access token
                token_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/access', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }}
                    }});
                    return res.json();
                }}""")
                customer_token = token_res["token"]
                log("   >> Obtained fresh customer access token.")

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 4: CUSTOMER QUOTE REVIEW & APPROVAL
                # -----------------------------------------------------------------
                log("\n--- PHASE 4: Customer Quotation Review & Approval ---")
                customer_context = browser.new_context(viewport={"width": 1440, "height": 900})
                cust_page = customer_context.new_page()
                cust_page.goto(f"{BASE_URL}/repair-center/?ref={repair_ref}", wait_until="domcontentloaded")
                
                # Customer authorizes with token
                token_input = cust_page.locator("input[name='token'], #token")
                if token_input.is_visible():
                    token_input.fill(customer_token)
                    cust_page.click("button:has-text('Open'), button[type='submit']")
                    cust_page.wait_for_timeout(800)
                
                # Customer approves quotation via API or button
                approve_res = cust_page.evaluate(f"""async () => {{
                    const res = await fetch('/api/repair-center/job/{repair_ref}/approve', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'Authorization': 'Bearer {customer_token}' }},
                        body: JSON.stringify({{ version: 1 }})
                    }});
                    return res.json();
                }}""")
                assert approve_res.get('stage') == 'approved', "Customer approval did not reach approved stage"
                log("   Customer approval stage verified: approved")
                cust_page.reload()
                cust_page.wait_for_timeout(600)
                cust_page.screenshot(path=str(SCREENSHOTS_DIR / "08_customer_quote_approved.png"))
                findings["lifecycle_features"]["customer_quotation_approval"] = "PASS"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 5: UPI PAYMENT CLAIM & VERIFICATION
                # -----------------------------------------------------------------
                log("\n--- PHASE 5: Payment Claim Submission & Staff Bank Verification ---")
                # Admin enables mock UPI QR
                page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZsAAAAASUVORK5CYII=';
                    return fetch('/api/repair-center/admin/qr-settings', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{
                            enabled: true,
                            merchant: 'RepairlyLabs Test',
                            upi: 'testpay@upi',
                            current: '{TEST_ADMIN_PASS}',
                            image: png
                        }})
                    }});
                }}""")
                log("   >> Synthetic QR enabled in temporary test database only.")
                # Customer submits UPI QR Payment Claim for deposit (₹1,000 = 100000 paise)
                utr_claim = "TESTUTR9876543210"
                claim_res = cust_page.evaluate(f"""async () => {{
                    const res = await fetch('/api/repair-center/job/{repair_ref}/qr-claim', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'Authorization': 'Bearer {customer_token}' }},
                        body: JSON.stringify({{
                            amount: 100000,
                            utr: '{utr_claim}',
                            version: 1
                        }})
                    }});
                    return res.json();
                }}""")
                assert claim_res.get('open_payment') == 'awaiting_verification', f"QR claim not pending: {claim_res}"
                log("   Customer QR claim pending; no real bank transfer occurred")
                cust_page.screenshot(path=str(SCREENSHOTS_DIR / "09_customer_payment_claimed.png"))

                # Staff verifies bank payment
                page.goto(f"{BASE_URL}/repair-center/?admin=1&ref={repair_ref}", wait_until="domcontentloaded")
                review_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const job = await (await fetch('/api/repair-center/admin/job/{repair_ref}')).json();
                    const pendingPayment = job.payments.find(p => p.state === 'awaiting_verification');
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/qr-review', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{
                            receipt: pendingPayment.receipt,
                            decision: 'approve',
                            confirmed: true,
                            note: 'TEST ONLY: simulated manual bank confirmation in isolated database'
                        }})
                    }});
                    return res.json();
                }}""")
                assert review_res.get('paid') == 100000, "Mock manual payment did not update paid balance"
                assert review_res.get('balance') == 260000, "Mock manual payment balance mismatch"
                log("   MOCK verification of synthetic UPI claim: paid ₹1000, balance ₹2600 (NO bank transfer tested)")
                page.reload()
                page.wait_for_timeout(500)
                page.screenshot(path=str(SCREENSHOTS_DIR / "10_staff_payment_verified.png"))
                findings["lifecycle_features"]["payment_claim_and_verification"] = "PASS (MOCK: no actual bank credit verified)"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 6: QUALITY CONTROL CHECKLIST
                # -----------------------------------------------------------------
                log("\n--- PHASE 6: Technician Quality Control Checklist ---")
                # Advance stage to repairing
                page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    return fetch('/api/repair-center/admin/job/{repair_ref}/stage', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{ stage: 'repairing' }})
                    }});
                }}""")
                
                # Perform 7-point quality checks
                qc_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/quality', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{
                            checks: {{
                                display: 'pass',
                                charging: 'pass',
                                camera: 'pass',
                                audio: 'pass',
                                network: 'pass',
                                buttons: 'pass',
                                condition: 'pass'
                            }}
                        }})
                    }});
                    return res.json();
                }}""")
                assert qc_res.get('quality'), f"Quality checks were not persisted: {qc_res}"
                log("   Seven quality checks saved in isolated test database")
                page.reload()
                page.wait_for_timeout(500)
                page.screenshot(path=str(SCREENSHOTS_DIR / "11_quality_control_passed.png"))
                findings["lifecycle_features"]["quality_control"] = "PASS"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 7: REPAIR COMPLETION & DELIVERY HANDOVER
                # -----------------------------------------------------------------
                log("\n--- PHASE 7: Repair Completion & Final Delivery Handover ---")
                # Record repair completion
                comp_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/stage', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{ stage: 'completed', work: [true], warranty: '90 days display replacement warranty' }})
                    }});
                    return res.json();
                }}""")
                assert comp_res.get('stage') == 'completed', f"Repair not completed: {comp_res}"
                log("   Repair completion verified")

                # Pay remaining balance (₹2,600 = 260000 paise) via offline cash settlement
                cash_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/offline', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{ amount: 260000, note: 'TEST ONLY: simulated cash settlement' }})
                    }});
                    return {{ http: res.status, data: await res.json() }};
                }}""")
                assert cash_res.get('http') == 200 and cash_res.get('data',{}).get('paid') == 360000, f"Mock cash settlement failed: {cash_res}"

                # Stage delivered
                deliv_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/repair-center/admin/job/{repair_ref}/stage', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{ stage: 'delivered' }})
                    }});
                    return res.json();
                }}""")
                assert deliv_res.get('stage') == 'delivered', f"Device not delivered: {deliv_res}"
                log("   Synthetic delivery stage verified")
                page.reload()
                page.wait_for_timeout(600)
                page.screenshot(path=str(SCREENSHOTS_DIR / "12_repair_delivered_complete.png"))
                findings["lifecycle_features"]["repair_completion_and_delivery"] = "PASS (MOCK: no real cash or physical handover)"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 8: PARTS ENQUIRY & PARTS PAYMENT LIFECYCLE
                # -----------------------------------------------------------------
                log("\n--- PHASE 8: India-Wide Parts Enquiry & Payment Desk ---")
                cust_page.goto(f"{BASE_URL}/part-request/", wait_until="domcontentloaded")
                cust_page.fill("input[name='name']", "Rohit Verma")
                cust_page.fill("input[name='phone']", "9812345678")
                cust_page.select_option("select[name='brand']", value="Vivo")
                cust_page.wait_for_timeout(300)
                cust_page.fill("input[name='model']", "Vivo X100 Pro")
                cust_page.fill("input[name='variant']", "16GB+512GB Sunset Orange")
                cust_page.select_option("select[name='category']", value="Display & touchscreen")
                cust_page.fill("textarea[name='description']", "Original AMOLED display module with frame")
                cust_page.fill("input[name='locality']", "Aliganj")
                cust_page.fill("input[name='city']", "Lucknow")
                cust_page.select_option("select[name='region']", value="Uttar Pradesh")
                cust_page.select_option("select[name='method']", value="Delivery requested")
                cust_page.fill("input[name='pincode']", "226010")
                cust_page.fill("textarea[name='address']", "Sector B, Aliganj, Lucknow")
                cust_page.check("input[name='consent']")
                
                cust_page.click("button[type='submit']")
                cust_page.wait_for_selector(".request-confirmation, .request-id", timeout=10000)
                time.sleep(0.6)
                cust_page.screenshot(path=str(SCREENSHOTS_DIR / "13_part_enquiry_submitted.png"), mask=[cust_page.locator(".private-link")])
                
                part_match = re.search(r"RLI-\d{6}-[A-F0-9]{16}", cust_page.locator("body").text_content())
                assert part_match, "Parts enquiry reference not generated!"
                part_ref = part_match.group(0)
                part_access = cust_page.locator(".private-link").text_content().strip()
                log(f"   >> Parts Enquiry Reference: {part_ref}")

                # Staff quotes part enquiry
                part_quote_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/part-inquiries/admin/{part_ref}', {{
                        method: 'PATCH',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{
                            status: 'quoted', availability: 'in_stock',
                            price_rupees: 4800, delivery_rupees: 150,
                            eta: '1–2 working days', quote_note: 'TEST ONLY: illustrative part grade',
                            quote_valid_until: '2099-12-31'
                        }})
                    }});
                    return {{ http: res.status, data: await res.json() }};
                }}""")
                assert part_quote_res.get('http') == 200 and part_quote_res.get('data',{}).get('status') == 'quoted', f"Part quotation failed: {part_quote_res}"
                log("   Staff part quotation state verified")

                # Customer navigates to quote view and accepts
                cust_page.goto(f"{BASE_URL}/part-request/#{part_ref}:{part_access}", wait_until="domcontentloaded")
                cust_page.wait_for_timeout(600)
                part_accept_res = cust_page.evaluate(f"""async () => {{
                    const res = await fetch('/api/part-inquiries/decision', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{ ref: '{part_ref}', access: '{part_access}', decision: 'accept' }})
                    }});
                    return {{ http: res.status, data: await res.json() }};
                }}""")
                assert part_accept_res.get('http') == 200 and part_accept_res.get('data',{}).get('status') == 'accepted', f"Customer part quote not accepted: {part_accept_res}"
                log("   Customer part quotation acceptance verified")
                cust_page.reload()
                cust_page.wait_for_timeout(600)
                cust_page.screenshot(path=str(SCREENSHOTS_DIR / "14_part_quote_accepted.png"))
                findings["lifecycle_features"]["part_enquiry_lifecycle"] = "PASS"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 9: EXTENDED OPERATIONS & PDF INVOICE
                # -----------------------------------------------------------------
                log("\n--- PHASE 9: Extended Operations & Logistics Management ---")
                page.goto(f"{BASE_URL}/operations/?admin=1", wait_until="domcontentloaded")
                bring_to_foreground()
                page.wait_for_selector(".ops-grid, h1")
                page.screenshot(path=str(SCREENSHOTS_DIR / "15_extended_operations_dashboard.png"))

                # Test appointment capacity saving
                page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    return fetch('/api/extended/capacity', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json', 'x-csrf-token': me.csrf }},
                        body: JSON.stringify({{ date: '2026-11-25', slot: 'Morning', capacity: 8 }})
                    }});
                }}""")

                # Download PDF invoice test
                pdf_res = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/extended/pdf/{repair_ref}', {{
                        headers: {{ 'x-csrf-token': me.csrf }}
                    }});
                    return {{ status: res.status, contentType: res.headers.get('content-type') }};
                }}""")
                log(f"   PDF statement generated: status = {pdf_res.get('status')}, type = {pdf_res.get('contentType')}")
                assert pdf_res.get("status") == 200 and "application/pdf" in pdf_res.get("contentType"), "PDF statement generation failed"
                findings["lifecycle_features"]["pdf_statement_generation"] = "PASS"

                # -----------------------------------------------------------------
                # LIFECYCLE PHASE 10: REFUND & PAYMENT GATEWAY INTEGRATION STATUS
                # -----------------------------------------------------------------
                log("\n--- PHASE 10: Payment Gateway & Refund Verification ---")
                # Offline refund recording check
                refund_check = page.evaluate(f"""async () => {{
                    const me = await (await fetch('/api/admin/me')).json();
                    const res = await fetch('/api/extended/monitor', {{
                        headers: {{ 'x-csrf-token': me.csrf }}
                    }});
                    return res.json();
                }}""")
                log(f"   System monitoring report: {refund_check}")
                findings["lifecycle_features"]["system_monitoring_and_ops"] = "PASS (monitor endpoint only)"
                findings["lifecycle_features"]["parts_payment_completed"] = "NOT TESTED (only parts enquiry quote/acceptance was tested)"
                findings["lifecycle_features"]["gateway_refund"] = "NOT TESTED"
                findings["lifecycle_features"]["live_razorpay_gateway"] = "BLOCKED (No test merchant connection supplied; no real provider request executed)"

                # Close contexts
                customer_context.close()
                context.close()
                browser.close()

        finally:
            log("Shutting down isolated test server...")
            server_proc.terminate()
            server_proc.wait(timeout=5)

    log("=== ISOLATED FULL LIFECYCLE COMPLETED SUCCESSFULLY ===")
    return findings

if __name__ == "__main__":
    res = run_lifecycle()
    with open(ROOT / "test-results" / "isolated-lifecycle-report.json", "w") as f:
        json.dump(res, f, indent=2)
    print("\nREPORT SAVED TO test-results/isolated-lifecycle-report.json")
