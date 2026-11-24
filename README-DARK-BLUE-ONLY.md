# RepairlyLabs — DARK BLUE ONLY color replacement

**Change scope:** only dark blue background surfaces -> warm charcoal/espresso. The original orange and cream remain unchanged. All layouts, logo, petal intro, font, service cards, buttons, forms, and backend are untouched.

## Colors
- Main dark warm charcoal: `#352D29`
- Slightly lighter warm charcoal: `#4A3B34`
- Deep warm charcoal: `#292320`

## Install on your latest local project

1. Back up your current project. Do **not** replace any production `.env`, `data/`, or SQLite files.
2. Copy the patch's `public/` and `scripts/` directories, and `Apply Dark Blue Only.cmd`, into the existing project ROOT.
3. Double-click `Apply Dark Blue Only.cmd` or run `node scripts/apply-dark-blue-only.mjs` from the project root.
4. Refresh the website (Ctrl+Shift+R) and check `/`, `/repairs`, `/parts`, and `/part-request/` on desktop and mobile.
5. Run your current project tests. The installer edits only stylesheet link tags in two public HTML files; originals are saved under `.repairly-color-backups/`.

**If you applied the previously rejected Warm Cream & Coral patch:** this installer removes only its `cream-harmony.css` stylesheet links, restoring your original pre-cream website styling. It does not delete any of your files. The new CSS then recolors only dark backgrounds.

**Important:** The provided source ZIP is an older snapshot than your latest locally integrated logo intro. For that reason, this patch is intentionally CSS-only and must be merged into your **current local project** instead of replacing the whole project. It has not been tested in your actual Windows Chrome session.
