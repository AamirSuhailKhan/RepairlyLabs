import os, zipfile

def make_archives():
    artifacts_dir = r'C:\Users\aamir\.gemini\antigravity\brain\91966b9b-208f-45ae-bf1a-fe485f2fc307'
    os.makedirs(artifacts_dir, exist_ok=True)

    full_zip = os.path.join(artifacts_dir, 'RepairlyLabs-Cinematic-Petals-Harmonized-Full.zip')
    patch_zip = os.path.join(artifacts_dir, 'RepairlyLabs-Cinematic-Petals-Patch.zip')

    # Exclusions for full zip
    exclude_dirs = {'.git', 'node_modules', '.gemini', 'tmp', 'temp_zip_extract', 'test-results', '__pycache__'}
    exclude_files = {'.env', 'repairlylabs.sqlite', 'repairlylabs.sqlite-shm', 'repairlylabs.sqlite-wal'}

    print('Building full source ZIP...')
    with zipfile.ZipFile(full_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if file in exclude_files or file.endswith(('.tmp', '.log')):
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, '.')
                zf.write(full_path, rel_path)

    full_mb = os.path.getsize(full_zip) / (1024 * 1024)
    print(f'Full ZIP created: {full_zip} ({full_mb:.2f} MB)')

    # Integration patch files
    patch_files = [
        'public/index.html',
        'public/styles.css',
        'public/smooth-brand-intro-boot.js',
        'public/smooth-brand-intro.css',
        'public/smooth-brand-intro.js',
        'public/assets/brand/prismatic-spiral-transparent.webp',
        'public/assets/brand/prismatic-spiral-transparent.png',
        'public/assets/brand/prismatic-spiral-original.webp',
        'Watch RepairlyLabs Intro in Chrome.cmd',
        'tests/brand-intro.test.mjs',
        'tests/record_cinematic_intro.py',
        'public/brand-intro.css',
        'public/brand-intro.js',
        'scripts/reconstruct_complete_petals.py'
    ]

    print('Building patch ZIP...')
    with zipfile.ZipFile(patch_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel_path in patch_files:
            if os.path.exists(rel_path):
                zf.write(rel_path, rel_path)

    patch_mb = os.path.getsize(patch_zip) / (1024 * 1024)
    print(f'Patch ZIP created: {patch_zip} ({patch_mb:.2f} MB)')

if __name__ == '__main__':
    make_archives()
