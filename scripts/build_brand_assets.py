import os
from pathlib import Path
from collections import deque
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = ROOT / "public" / "assets" / "brand"
BRAND_DIR.mkdir(parents=True, exist_ok=True)

SOURCE_PATH = Path(r"C:/Users/aamir/.gemini/antigravity/brain/91966b9b-208f-45ae-bf1a-fe485f2fc307/.user_uploaded/media_1795417398786_def5ac65.jpg")

print(f"Loading source logo from: {SOURCE_PATH}")
orig = Image.open(SOURCE_PATH).convert("RGB")
w, h = orig.size
pix = orig.load()

# 1. Save original without modification
orig.save(BRAND_DIR / "repairlylabs-logo-original.webp", "WEBP", quality=100)
print("Saved repairlylabs-logo-original.webp")

# 2. Precise exterior background extraction with halo prevention
# Step 2a: Exterior flood fill with threshold <= 2
ext_bg = bytearray(w * h)
q = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
for x, y in q:
    ext_bg[y * w + x] = 1

while q:
    x, y = q.popleft()
    for nx, ny in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]:
        if 0 <= nx < w and 0 <= ny < h and not ext_bg[ny * w + nx]:
            ext_bg[ny * w + nx] = 1
            r, g, b = pix[nx, ny]
            if max(r, g, b) <= 2:
                q.append((nx, ny))

# Step 2b: Exterior flood fill with threshold <= 22 (outer transition zone)
ext_trans = bytearray(w * h)
q2 = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
for x, y in q2:
    ext_trans[y * w + x] = 1

while q2:
    x, y = q2.popleft()
    for nx, ny in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]:
        if 0 <= nx < w and 0 <= ny < h and not ext_trans[ny * w + nx]:
            ext_trans[ny * w + nx] = 1
            r, g, b = pix[nx, ny]
            if max(r, g, b) <= 22:
                q2.append((nx, ny))

# Step 2c: Construct transparent master RGBA
rgba_master = Image.new("RGBA", (w, h), (0, 0, 0, 0))
rgba_pix = rgba_master.load()

for y in range(h):
    for x in range(w):
        idx = y * w + x
        r, g, b = pix[x, y]
        m = max(r, g, b)
        if ext_bg[idx]:
            rgba_pix[x, y] = (0, 0, 0, 0)
        elif ext_trans[idx]:
            # Smooth step curve
            alpha_f = max(0.0, min(1.0, (m - 2.0) / (22.0 - 2.0)))
            alpha_f = alpha_f * alpha_f * (3.0 - 2.0 * alpha_f)
            alpha = int(alpha_f * 255)
            if alpha > 0:
                unmul = max(0.15, alpha_f)
                ur = min(255, int(r / unmul))
                ug = min(255, int(g / unmul))
                ub = min(255, int(b / unmul))
                rgba_pix[x, y] = (ur, ug, ub, alpha)
            else:
                rgba_pix[x, y] = (0, 0, 0, 0)
        else:
            rgba_pix[x, y] = (r, g, b, 255)

rgba_master.save(BRAND_DIR / "repairlylabs-logo-transparent.png", "PNG", optimize=True)
rgba_master.save(BRAND_DIR / "repairlylabs-logo-transparent.webp", "WEBP", quality=95, lossless=True)
print("Saved repairlylabs-logo-transparent.png and .webp")

# Find bounding box of the flower to ensure perfect optical centering and framing
bbox = rgba_master.getbbox() # (min_x, min_y, max_x, max_y)
flower_cropped = rgba_master.crop(bbox)
fw, fh = flower_cropped.size
max_dim = max(fw, fh)

def make_icon(size, padding_ratio=0.06):
    """Generates an optically centered square icon with slight padding."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    target_dim = int(size * (1.0 - 2 * padding_ratio))
    if max_dim == fw:
        new_w = target_dim
        new_h = int(fh * (target_dim / fw))
    else:
        new_h = target_dim
        new_w = int(fw * (target_dim / fh))
    
    resized = flower_cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    pos_x = (size - new_w) // 2
    pos_y = (size - new_h) // 2
    canvas.paste(resized, (pos_x, pos_y), resized)
    return canvas

# Standard square sizes
sizes = {
    "repairlylabs-logo-512.png": 512,
    "repairlylabs-logo-256.png": 256,
    "repairlylabs-logo-192.png": 192,
    "repairlylabs-logo-128.png": 128,
    "repairlylabs-logo-64.png": 64,
    "repairlylabs-favicon-32.png": 32,
    "repairlylabs-favicon-16.png": 16,
}

for filename, sz in sizes.items():
    icon = make_icon(sz, padding_ratio=0.04 if sz >= 64 else 0.02)
    icon.save(BRAND_DIR / filename, "PNG", optimize=True)
    print(f"Saved {filename} ({sz}x{sz})")

# Apple touch icon (180x180) - with subtle dark navy tile as standard for iOS homescreen
apple_icon = Image.new("RGBA", (180, 180), (8, 18, 31, 255))
flower_150 = make_icon(150, padding_ratio=0.03)
apple_icon.paste(flower_150, (15, 15), flower_150)
apple_icon.save(BRAND_DIR / "apple-touch-icon.png", "PNG", optimize=True)
apple_icon.save(ROOT / "public" / "apple-touch-icon.png", "PNG", optimize=True)
print("Saved apple-touch-icon.png (180x180)")

# Multi-resolution favicon.ico (16, 32, 48, 64)
ico_16 = make_icon(16, padding_ratio=0.0)
ico_32 = make_icon(32, padding_ratio=0.02)
ico_48 = make_icon(48, padding_ratio=0.03)
ico_64 = make_icon(64, padding_ratio=0.04)

ico_images = [ico_16, ico_32, ico_48, ico_64]
ico_path_brand = BRAND_DIR / "favicon.ico"
ico_path_public = ROOT / "public" / "favicon.ico"
ico_16.save(ico_path_brand, format="ICO", sizes=[(16,16), (32,32), (48,48), (64,64)], append_images=ico_images[1:])
ico_16.save(ico_path_public, format="ICO", sizes=[(16,16), (32,32), (48,48), (64,64)], append_images=ico_images[1:])
print("Saved favicon.ico (multi-resolution 16, 32, 48, 64)")

# Create high-res SVG for favicon.svg and brand SVG
svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="p-orange" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff9900"/>
      <stop offset="100%" stop-color="#ff4400"/>
    </linearGradient>
    <linearGradient id="p-yellow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffea00"/>
      <stop offset="100%" stop-color="#ff9900"/>
    </linearGradient>
    <linearGradient id="p-lime" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a6ff00"/>
      <stop offset="100%" stop-color="#55cc00"/>
    </linearGradient>
    <linearGradient id="p-teal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00e5a3"/>
      <stop offset="100%" stop-color="#008899"/>
    </linearGradient>
    <linearGradient id="p-blue" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00b4d8"/>
      <stop offset="100%" stop-color="#0044cc"/>
    </linearGradient>
    <linearGradient id="p-royal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4361ee"/>
      <stop offset="100%" stop-color="#3a0ca3"/>
    </linearGradient>
    <linearGradient id="p-purple" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7209b7"/>
      <stop offset="100%" stop-color="#560bad"/>
    </linearGradient>
    <linearGradient id="p-magenta" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f72585"/>
      <stop offset="100%" stop-color="#b5179e"/>
    </linearGradient>
    <linearGradient id="p-coral" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff5964"/>
      <stop offset="100%" stop-color="#e01e37"/>
    </linearGradient>
  </defs>
  <!-- Prismatic Spiral Flower 8-Petal Geometry -->
  <g transform="translate(256, 256)">
    <!-- 8 logarithmic spiral curved petals rotated by 45 degrees -->
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-yellow)" transform="rotate(0)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-lime)" transform="rotate(45)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-teal)" transform="rotate(90)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-blue)" transform="rotate(135)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-royal)" transform="rotate(180)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-purple)" transform="rotate(225)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-magenta)" transform="rotate(270)"/>
    <path d="M 0,0 C 40,-40 120,-70 170,-40 C 220,-10 240,70 190,130 C 140,180 60,160 20,90 Z" fill="url(#p-coral)" transform="rotate(315)"/>
    <!-- Center spiral cavity -->
    <circle cx="0" cy="0" r="24" fill="#08121f"/>
  </g>
</svg>'''

(BRAND_DIR / "repairlylabs-logo.svg").write_text(svg_content, encoding="utf-8")
(ROOT / "public" / "assets" / "favicon.svg").write_text(svg_content, encoding="utf-8")
print("Saved repairlylabs-logo.svg and updated public/assets/favicon.svg")

# Clean up temporary test files
for t in ["test_raw_cut.png", "test_transparent.png", "test_on_white.png", "test_on_navy.png"]:
    tp = ROOT / t
    if tp.exists():
        tp.unlink()
        print(f"Cleaned up {t}")

print("=== IMAGE ASSETS GENERATED (OG Image to be rendered via HTML) ===")

(BRAND_DIR / "repairlylabs-logo.svg").write_text(svg_content, encoding="utf-8")
(ROOT / "public" / "assets" / "favicon.svg").write_text(svg_content, encoding="utf-8")
print("Saved repairlylabs-logo.svg and updated public/assets/favicon.svg")

# Clean up temporary test files
for t in ["test_raw_cut.png", "test_transparent.png", "test_on_white.png", "test_on_navy.png"]:
    tp = ROOT / t
    if tp.exists():
        tp.unlink()
        print(f"Cleaned up {t}")

print("=== ALL BRAND ASSETS SUCCESSFULLY GENERATED ===")
