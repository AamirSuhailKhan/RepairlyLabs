import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = ROOT / "public" / "assets" / "brand"
logo_512 = BRAND_DIR / "repairlylabs-logo-512.png"

with open(logo_512, "rb") as f:
    flower_b64 = base64.b64encode(f.read()).decode("utf-8")

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Space+Grotesk:wght@600;700;800&display=swap');
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: 1200px;
    height: 630px;
    background: #292320;
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
    color: #ffffff;
    display: flex;
    align-items: center;
    position: relative;
    overflow: hidden;
  }}
  .glow-a {{
    position: absolute;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(254, 150, 89, 0.15) 0%, rgba(41, 35, 32, 0) 70%);
    top: 15px;
    left: 20px;
  }}
  .glow-b {{
    position: absolute;
    width: 500px;
    height: 500px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(243, 127, 50, 0.1) 0%, rgba(41, 35, 32, 0) 70%);
    bottom: -100px;
    right: 50px;
  }}
  .grid-pattern {{
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
    background-size: 40px 40px;
  }}
  .content {{
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0 85px;
    gap: 65px;
  }}
  .emblem-wrapper {{
    flex-shrink: 0;
    width: 360px;
    height: 360px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }}
  .emblem-wrapper::before {{
    content: '';
    position: absolute;
    inset: 10px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, transparent 70%);
    filter: blur(20px);
  }}
  .emblem-img {{
    width: 100%;
    height: 100%;
    object-fit: contain;
    position: relative;
    z-index: 2;
    filter: drop-shadow(0 15px 35px rgba(0,0,0,0.5));
  }}
  .text-side {{
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }}
  .eyebrow {{
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #fe9659;
  }}
  .eyebrow::before {{
    content: '';
    display: block;
    width: 24px;
    height: 2px;
    background: currentColor;
  }}
  .brand-title {{
    font-family: 'Space Grotesk', sans-serif;
    font-size: 72px;
    font-weight: 700;
    letter-spacing: -0.05em;
    line-height: 1.05;
    color: #ffffff;
  }}
  .brand-title span {{
    color: #f37f32;
  }}
  .subtitle {{
    font-size: 21px;
    line-height: 1.5;
    color: #b2c5d0;
    max-width: 580px;
  }}
  .badges {{
    display: flex;
    gap: 12px;
    margin-top: 10px;
    flex-wrap: wrap;
  }}
  .badge {{
    padding: 8px 16px;
    border-radius: 100px;
    font-size: 13px;
    font-weight: 700;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #fdd381;
  }}
  .footer-bar {{
    margin-top: 15px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 14px;
    color: #6d8494;
    display: flex;
    justify-content: space-between;
  }}
</style>
</head>
<body>
  <div class="grid-pattern"></div>
  <div class="glow-a"></div>
  <div class="glow-b"></div>
  <div class="content">
    <div class="emblem-wrapper">
      <img src="data:image/png;base64,{flower_b64}" class="emblem-img" alt="RepairlyLabs Prismatic Emblem">
    </div>
    <div class="text-side">
      <div class="eyebrow">MOBILE REPAIRS FIRST · PARTS ACROSS INDIA</div>
      <h1 class="brand-title">Repairly<span>Labs</span></h1>
      <p class="subtitle">Customer-approved phone diagnosis, repair quotes & quality control. Nationwide spare parts enquiries with verified availability.</p>
      <div class="badges">
        <span class="badge">✓ Diagnosis & Quotes First</span>
        <span class="badge">✓ Zero Blind Payments</span>
        <span class="badge">✓ 7-Point QC Inspection</span>
      </div>
      <div class="footer-bar">
        <span>Varanasi Workshop · Nationwide Parts Support</span>
        <span>https://repairlylabs.in</span>
      </div>
    </div>
  </div>
</body>
</html>"""

with sync_playwright() as p:
    chrome_exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    browser = p.chromium.launch(
        executable_path=chrome_exe if Path(chrome_exe).exists() else None,
        headless=True
    )
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
    page.set_content(html, wait_until="networkidle")
    
    out_brand = BRAND_DIR / "repairlylabs-og.png"
    out_public = ROOT / "public" / "repairlylabs-og.png"
    
    page.screenshot(path=str(out_brand), type="png")
    page.screenshot(path=str(out_public), type="png")
    browser.close()

print(f"Generated {out_brand} and {out_public} (1200x630)")
