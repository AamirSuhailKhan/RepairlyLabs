# RepairlyLabs — Second Security Hardening Update (2026-11-22)

This updated ZIP contains the complete application source with **no live .env, database, recovery tokens, or customer data**.

## Verified offline
- Node automated tests: **28/28 PASS** (`npm test`)
- Functional API audit: **23/23 PASS** (`npm run audit`)
- Python browser runner: **syntax/compile PASS**, full headed Chrome test **BLOCKED** on this non-Windows environment
- Source secret scanner: **no matches for configured high-confidence patterns**; full Git history scan **BLOCKED** because `.git` is not present.
- Isolated local account revocation and recovery tests: **PASS**; no actual production account or database was changed.

## Security changes
1. Operator revoker requires explicit absolute database path + confirmation; creates and integrity-checks consistent backup before transaction. Revokes **all admin sessions**, one-time recovery links, *all offline recovery codes*, and pending verified-email reset links. Preserves password hashes and business records.
2. Successful owner recovery now invalidates *all* pre-existing offline codes and pending verified-email links for that owner, not only the single used token.
3. Local owner recovery helper opens a private one-time link in Windows browser without printing the secret URL to terminal output; checks local DB matches running server. Run it yourself from your Windows interactive desktop.
4. Browser-access utility no longer issues a recovery link if the SQLite database is absent or does not match the running server.
5. Isolated browser runner creates a temp database on port 3005, avoids inserting the ephemeral admin password into command-line arguments, and rejects inherited `.env` provider secrets.
6. Browser runner checks the **Default** interactive Windows desktop and foreground RepairlyLabs window, and uses Pillow to capture a **private actual monitor screenshot** locally. It fails rather than claiming visibility on an isolated desktop.
7. Browser startup/health checking and local launcher prerequisites are strengthened; missing dependencies are reported as BLOCKED.
8. Security regression tests expanded with extra admin sessions, stale offline codes and reset links, and the test environment guard.

## Apply to your current Windows project
- **Back up** the real `data/repairlylabs.sqlite` and your real `.env` securely before changing any code.
- Prefer merging the *Security Hardening Patch* instead of replacing your entire Windows project; newer local changes may exist.
- **Never replace** real `.env`, `data/`, or business database with files from a ZIP.
- Install Python test dependencies only in your local trusted environment: `python -m pip install -r tests/requirements-visible.txt`.
- Double-click `Watch RepairlyLabs Test in Chrome.cmd` from your physical Windows desktop. This tests against an isolated server on port 3005, not the normal business port.
- For locally authorized account review: `node scripts/audit-live-db-readonly.mjs --db="ABSOLUTE_PATH_TO_EXISTING_DB" --baseline="ABSOLUTE_PATH_TO_TRUSTED_PRIOR_BACKUP"`.
- If owner recovery tokens or passwords were exposed, have a trusted operator run `node scripts/revoke-compromised-access.mjs --db="ABSOLUTE_PATH_TO_EXISTING_DB" --confirm-revoke` and then privately use `node scripts/agent-owner-recovery.mjs` in an interactive Windows terminal. The first command **actively signs out all staff and admins** and invalidates *all* pending reset/backup codes; confirm business impact before executing.
- No Git push/deploy was performed. If old secrets were published in Git history, rotate them at the providers: editing a ZIP cannot revoke them.

## Remaining blockers
- Actual owner password-history and production data identification: **BLOCKED** without trusted live database + baseline backup. Numeric record ranges alone do not prove test data.
- Physical Windows Chrome and screenshot proof: **BLOCKED** here; Windows launcher supplied, not executed in user's session.
- Live Razorpay, bank settlement, OTP/WhatsApp delivery and real refunds: **NOT TESTED**. Simulated manual payment claims are not bank verification.
- Remote Git history: **BLOCKED**; this archive contains no `.git`. Run the safe scanner on the original checkout, or connect an authorized GitHub integration.

Keep locally captured monitor screenshots, browser videos, traces and any recovery URLs private. Files under `test-results/` are excluded from Git and this release.
