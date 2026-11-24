# RepairlyLabs interactive service journey V2
Base: GitHub archive 2a79716d3d2b7a5b33fabbfe683c16b66b0a19af.

## Install safely (recommended)
Stop the existing server. In the existing Git working tree run `git status` first. Preserve uncommitted changes. Download the .patch file, then run from the project root:

```powershell
git apply --check "$env:USERPROFILE\Downloads\RepairlyLabs-Journey-V2.patch"
git apply "$env:USERPROFILE\Downloads\RepairlyLabs-Journey-V2.patch"
git diff --stat
npm start
```
If the check fails, do not force apply. Ask Antigravity to merge the relevant changes against the current source. No database, .env, logo, backend, or admin source is changed. Full source ZIP is also provided for comparison; do not replace your live database or .env.

Open the terminal's localhost URL and hard refresh (Ctrl+Shift+R). Scroll the card into view. It cycles every 6.5 seconds after the intro and only while in view and not paused. Move the mouse away to see automatic motion. Hover/keyboard focus, hidden tab and manual selection pause it. Manual selection holds for 5 seconds. Play/Pause controls are available. Reduced-motion users start paused. The number pill selects the next option; rows select options; the CTA opens the selected form. Tracking provides separate repair and parts-quote links because the forms use different credentials.

## Actual checks in this environment
- JS syntax checks: passed.
- New controller tests (simulated DOM and animation frames): 2/2 passed.
- npm test: 53/54 passed. Existing independent-audit test assumes AI Studio iframe mode by default and fails with `CSP should allow AI Studio preview iframe`. The same failure was reproduced in the untouched source archive. No security assertion was disabled or weakened.
- npm run audit: 23/23 passed.
- Secret scanner: no configured-pattern findings across 139 files before adding this README.
- Real Chromium navigation: BLOCKED (administrator URL-block policy, net::ERR_BLOCKED_BY_ADMINISTRATOR). No claim of rendered visual verification or live browser interaction. No production data used.

## Browser verification on Windows
Install Python Playwright if required: `python -m pip install playwright`. The script uses the installed Google Chrome by default, or set CHROME_PATH to another installed Chromium executable. It starts a separate local server on an ephemeral port with a temporary database and does not submit real customer data.

```powershell
$env:HEADED='1'
python tests/hero_journey_browser.py
```
Evidence is stored in test-results/hero-journey/ (ignored by Git). Browser runner is syntax-checked but real execution is blocked here. The existing cross-platform audit was updated to expect the new text, not executed here. Review and commit verified changes only after local visual testing.
