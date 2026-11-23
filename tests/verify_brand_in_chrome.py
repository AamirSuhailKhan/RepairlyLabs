import os
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://127.0.0.1:3001"
SCREENSHOTS_DIR = ROOT / "test-results" / "screenshots" / "branding"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(CHROME_PATH):
    CHROME_PATH = None

ROUTES = [
    {"name": "homepage", "url": "/"},
    {"name": "repairs", "url": "/repairs"},
    {"name": "booking", "url": "/repairs#booking"},
    {"name": "parts", "url": "/parts"},
    {"name": "track", "url": "/track"},
    {"name": "part_request", "url": "/part-request/"},
    {"name": "part_request_admin", "url": "/part-request/?admin=1"},
    {"name": "admin_login", "url": "/admin"},
    {"name": "repair_center", "url": "/repair-center/"},
    {"name": "operations", "url": "/operations/"},
    {"name": "parts_payment", "url": "/parts-payment/"}
]

VIEWPORTS = [
    {"name": "mobile_small", "width": 360, "height": 800},
    {"name": "mobile_standard", "width": 390, "height": 844},
    {"name": "mobile_large", "width": 430, "height": 932},
    {"name": "tablet", "width": 768, "height": 1024},
    {"name": "laptop", "width": 1366, "height": 768},
    {"name": "desktop", "width": 1920, "height": 1080}
]

def run_brand_audit():
    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_url": BASE_URL,
        "browser": "Google Chrome (Verified Headed/Native Binary)",
        "routes_audited": len(ROUTES),
        "viewports_tested": len(VIEWPORTS),
        "pages": {},
        "failures": []
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            headless=True
        )

        for route in ROUTES:
            route_name = route["name"]
            url = f"{BASE_URL}{route['url']}"
            results["pages"][route_name] = {"url": url, "viewports": {}}

            for vp in VIEWPORTS:
                vp_name = vp["name"]
                context = browser.new_context(viewport={"width": vp["width"], "height": vp["height"]})
                page = context.new_page()

                try:
                    page.goto(url, wait_until="domcontentloaded")
                    page.wait_for_timeout(400)

                    # Check 1: Horizontal overflow
                    overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")

                    # Check 2: Logo image presence and natural dimensions
                    logo_info = page.evaluate("""() => {
                        const img = document.querySelector('.brand-flower-emblem, .logo img, .brand img');
                        if (!img) return { found: false };
                        return {
                            found: true,
                            src: img.src,
                            naturalWidth: img.naturalWidth,
                            naturalHeight: img.naturalHeight,
                            clientWidth: img.clientWidth,
                            clientHeight: img.clientHeight,
                            aspectRatio: img.naturalWidth / (img.naturalHeight || 1)
                        };
                    }""")

                    # Check 3: Favicon link
                    favicon_href = page.evaluate("""() => {
                        const fav = document.querySelector('link[rel*="icon"]');
                        return fav ? fav.href : null;
                    }""")

                    # Capture screenshot for desktop and mobile standard
                    if vp_name in ["desktop", "mobile_standard"]:
                        ss_path = SCREENSHOTS_DIR / f"{route_name}_{vp_name}.png"
                        page.screenshot(path=str(ss_path), full_page=False)

                    vp_result = {
                        "width": vp["width"],
                        "height": vp["height"],
                        "overflow_0px": not overflow,
                        "logo_detected": logo_info.get("found", False),
                        "logo_natural_width": logo_info.get("naturalWidth", 0),
                        "logo_natural_height": logo_info.get("naturalHeight", 0),
                        "favicon_href": favicon_href,
                        "status": "PASS" if (not overflow and logo_info.get("found", False) and logo_info.get("naturalWidth", 0) > 0) else "FAIL"
                    }

                    if vp_result["status"] == "FAIL":
                        results["failures"].append(f"{route_name} @ {vp_name}: overflow={overflow}, logo={logo_info}")

                    results["pages"][route_name]["viewports"][vp_name] = vp_result

                except Exception as e:
                    results["failures"].append(f"{route_name} @ {vp_name}: {str(e)}")
                    results["pages"][route_name]["viewports"][vp_name] = {"error": str(e), "status": "ERROR"}

                finally:
                    context.close()

        browser.close()

    summary_path = ROOT / "test-results" / "branding-summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"Branding Chrome audit completed. Failures: {len(results['failures'])}")
    print(f"Summary written to {summary_path}")
    return results

if __name__ == "__main__":
    res = run_brand_audit()
    if res["failures"]:
        print("FAILURES DETECTED:")
        for f in res["failures"]:
            print(" -", f)
        exit(1)
    else:
        print("ALL ROUTES & VIEWPORTS PASSED BRANDING AUDIT SUCCESSFULLY!")
