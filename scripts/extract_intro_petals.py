import os, math, colorsys
from collections import deque
from PIL import Image

def extract_petals():
    os.makedirs('public/assets/brand/intro', exist_ok=True)
    os.makedirs('test-results', exist_ok=True)

    src_path = 'public/assets/brand/repairlylabs-logo-transparent.png'
    img = Image.open(src_path).convert('RGBA')
    w, h = img.size
    cx, cy = 514, 495
    pixels = img.load()

    labels = [[-1 for _ in range(w)] for _ in range(h)]
    assigned_queue = deque()

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            v = max(r, g, b)
            dist = math.hypot(x - cx, y - cy)
            if dist < 22 and v < 30:
                labels[y][x] = 8 # center
                continue
                
            h_deg, s, val = colorsys.rgb_to_hsv(r/255, g/255, b/255)
            h_deg = h_deg * 360
            angle = (math.degrees(math.atan2(y - cy, x - cx)) + 360) % 360
            
            idx = None
            if (h_deg >= 335 or h_deg < 12) and (190 <= angle <= 330):
                idx = 0
            elif (275 <= h_deg < 335):
                idx = 1
            elif (215 <= h_deg < 275):
                idx = 2
            elif (175 <= h_deg < 215):
                idx = 3
            elif (120 <= h_deg < 175):
                idx = 4
            elif (60 <= h_deg < 120):
                idx = 5
            elif (10 <= h_deg < 35) and (120 <= angle <= 260):
                idx = 6
            elif (35 <= h_deg < 60):
                idx = 7
                
            if idx is not None:
                labels[y][x] = idx
                assigned_queue.append((x, y))

    # BFS propagation for smooth edge assignment
    while assigned_queue:
        qx, qy = assigned_queue.popleft()
        ql = labels[qy][qx]
        if ql == 8:
            continue
        for dx, dy in ((-1,0),(1,0),(0,-1),(0,1)):
            nx, ny = qx + dx, qy + dy
            if 0 <= nx < w and 0 <= ny < h:
                if pixels[nx, ny][3] > 0 and labels[ny][nx] == -1:
                    labels[ny][nx] = ql
                    assigned_queue.append((nx, ny))

    petal_names = [
        'petal-01', # Coral-Red (top)
        'petal-02', # Purple (upper right)
        'petal-03', # Blue (right)
        'petal-04', # Cyan (bottom right)
        'petal-05', # Emerald (bottom)
        'petal-06', # Lime (bottom left)
        'petal-07', # Orange (left)
        'petal-08', # Yellow (top left)
    ]

    reconstructed = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    for idx, name in enumerate(petal_names):
        petal_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        p_pix = petal_img.load()
        for y in range(h):
            for x in range(w):
                if labels[y][x] == idx:
                    p_pix[x, y] = pixels[x, y]
        
        png_path = f'public/assets/brand/intro/{name}.png'
        webp_path = f'public/assets/brand/intro/{name}.webp'
        petal_img.save(png_path, optimize=True)
        petal_img.save(webp_path, 'WEBP', quality=95)
        reconstructed.alpha_composite(petal_img)

    # Save center spiral
    center_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    c_pix = center_img.load()
    for y in range(h):
        for x in range(w):
            if labels[y][x] == 8:
                c_pix[x, y] = pixels[x, y]
    center_png = 'public/assets/brand/intro/center-spiral.png'
    center_webp = 'public/assets/brand/intro/center-spiral.webp'
    center_img.save(center_png, optimize=True)
    center_img.save(center_webp, 'WEBP', quality=95)
    reconstructed.alpha_composite(center_img)

    reconstructed.save('test-results/reconstructed-logo.png')
    print('Extraction complete. Reconstructed logo saved.')

if __name__ == '__main__':
    extract_petals()
