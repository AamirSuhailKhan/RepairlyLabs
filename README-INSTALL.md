# RepairlyLabs — Warm Cream & Coral Palette (Safe Frontend Patch)

## What changes

- Replaces the large navy homepage hero with a light warm-cream/peach gradient and readable dark headings.
- Uses a porcelain/cream navigation bar with dark links and a stronger coral repair CTA.
- Changes dark brand strips, process sections, parts landing hero and public footer to warm, coordinated surfaces.
- Makes the independent nationwide parts-enquiry page match the new customer-facing palette.
- Maintains neutral white cards, accessible dark text and clear button contrast.
- **Does not alter the multicolor spiral logo, cinematic intro, backend, tests, login or payment modules.**

## Why it is a patch, not a replacement full project

Your recent local version may contain logo and intro changes newer than the most recent source ZIP available to this review. A full-project replacement could discard them. Apply this CSS-only patch to the actual latest Windows project instead.

## Installation

1. Make a normal project backup first, and keep `.env` / `data/` unchanged.
2. Merge `public/` and `scripts/` from this patch into the current RepairlyLabs project root. Preserve all other files.
3. Run `node scripts/install-cream-theme.mjs` from your project root (or double-click `Apply Warm Cream Theme.cmd` after copying it into the root).
4. The installer adds CSS links to `public/index.html` and `public/part-request/index.html`, with a cache-busting version. It backs up both original HTML files inside `.repairly-theme-backups/`.
5. Restart the existing local server, then open the homepage and parts request form. Refresh with Ctrl+Shift+R.
6. Compare desktop and mobile visuals and check form submissions in your safe test environment.

## Files added

- `public/cream-harmony.css`
- `public/part-request/cream-harmony.css`
- `scripts/install-cream-theme.mjs`
- `Apply Warm Cream Theme.cmd`

## Technical verification for the review copy

- Existing Node suite: 28/28 passed.
- Existing API audit: 23/23 passed.
- Isolated HTML/CSS rendering fixture at 1440px and 390px showed no horizontal overflow and no page JavaScript errors. These are **fixture checks**, not live-site Chrome E2E checks.
- Direct browser navigation to localhost was blocked by administrator policy, so full site visual navigation remains NOT TESTED here.
- These tests used an older uploaded baseline; the most recent local logo intro and current project changes are not in that baseline.

## Brand palette

- Porcelain cream: `#FFFAF5`
- Apricot: `#FFE9D8`
- Light peach: `#FFF0E5`
- Dark ink: `#302820`
- Body text: `#665B54`
- Contrast-safe CTA rust/coral: `#BD4D36`

Do not call your live customer database a test database. Validate separately before production deployment.
