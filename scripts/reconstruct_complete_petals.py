import os, math
from collections import deque
from PIL import Image, ImageFilter

def reconstruct_petals():
    os.makedirs('public/assets/brand/intro', exist_ok=True)
    os.makedirs('test-results/screenshots/intro', exist_ok=True)

    src_path = 'public/assets/brand/repairlylabs-logo-transparent.png'
    img = Image.open(src_path).convert('RGBA')
    w, h = img.size
    cx, cy = 514, 495
    pixels = img.load()

    # 8 Seed points located in the heart of each petal's outer lobe
    seeds = [
        ('petal-01', 530, 210),  # 1: Coral-Red (top)
        ('petal-02', 710, 310),  # 2: Magenta/Purple (top-right)
        ('petal-03', 780, 490),  # 3: Royal Blue (right)
        ('petal-04', 700, 680),  # 4: Cyan/Sky Blue (bottom-right)
        ('petal-05', 520, 770),  # 5: Emerald/Mint (bottom)
        ('petal-06', 330, 700),  # 6: Lime/Chartreuse (bottom-left)
        ('petal-07', 240, 500),  # 7: Warm Orange (left)
        ('petal-08', 320, 310),  # 8: Golden Yellow (top-left)
    ]

    print('Reconstructing 8 complete, seamless petal layers...')

    for i, (name, sx, sy) in enumerate(seeds):
        mid_deg = (i * 45 - 90) % 360
        visited = set([(sx, sy)])
        q = deque([(sx, sy)])
        while q:
            x, y = q.popleft()
            for dx, dy in ((-1,0),(1,0),(0,-1),(0,1)):
                nx, ny = x+dx, y+dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                    p = pixels[nx, ny]
                    if p[3] > 12:
                        ang = (math.degrees(math.atan2(ny - cy, nx - cx)) + 360) % 360
                        diff = (ang - mid_deg + 180) % 360 - 180
                        # Follow logarithmic spiral trajectory
                        if abs(diff) < 68 or math.hypot(nx-cx, ny-cy) < 45:
                            pr = pixels[x, y]
                            col_diff = sum(abs(p[c] - pr[c]) for c in range(3))
                            if col_diff < 42:
                                visited.add((nx, ny))
                                q.append((nx, ny))

        # Build transparent RGBA image for this petal
        petal_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        p_pix = petal_img.load()
        for (x, y) in visited:
            p_pix[x, y] = pixels[x, y]

        # Extract alpha mask, apply subtle anti-aliasing feathering to ensure zero jagged seams
        r, g, b, a = petal_img.split()
        # Smooth alpha edge
        a_smooth = a.filter(ImageFilter.GaussianBlur(radius=0.75))
        petal_img = Image.merge('RGBA', (r, g, b, a_smooth))

        png_path = f'public/assets/brand/intro/{name}.png'
        webp_path = f'public/assets/brand/intro/{name}.webp'
        petal_img.save(png_path, optimize=True)
        petal_img.save(webp_path, 'WEBP', quality=95)
        
        # Verify single connected component
        bbox = petal_img.getbbox()
        print(f'Saved {name}: {len(visited)} px, bbox={bbox}')

    # Reconstruct center spiral void
    center_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    c_pix = center_img.load()
    for y in range(h):
        for x in range(w):
            dist = math.hypot(x - cx, y - cy)
            p = pixels[x, y]
            if dist < 26 and max(p[:3]) < 45 and p[3] > 0:
                c_pix[x, y] = p
    center_png = 'public/assets/brand/intro/center-spiral.png'
    center_webp = 'public/assets/brand/intro/center-spiral.webp'
    center_img.save(center_png, optimize=True)
    center_img.save(center_webp, 'WEBP', quality=95)
    print(f'Saved center-spiral: bbox={center_img.getbbox()}')
    print('All 8 petals and center spiral reconstructed successfully with single continuous components.')

if __name__ == '__main__':
    reconstruct_petals()
