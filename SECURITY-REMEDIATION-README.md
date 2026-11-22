# RepairlyLabs — Safe integration and security response

## Read before updating a running business site

This package was modified **offline** from the user-supplied source ZIP. It contains **no** live SQLite database, actual `.env`, or Git history. No passwords, tokens, customer records, sessions or GitHub remote were modified by this offline review.

1. Stop the running application and take a **verified, consistent database backup** on your actual host (`npm run backup` uses the configured `DATA_DIR`). Preserve your `.env` and `data` folders.
2. Merge code changes; **do not overwrite** existing database records or environment secrets. Copy updated `.mjs`, `.js` and test utilities carefully and restart the correct server.
3. **Do not use any owner recovery links pasted into chat, screenshots, or audit reports.** Ask a trusted local operator to revoke any outstanding links and owner sessions, then use a newly issued private one-time link or verified email recovery. Never put the new link in an audit report.
4. Your coding agent can run `node scripts/audit-live-db-readonly.mjs --db="ABSOLUTE_EXISTING_SQLITE_PATH" --baseline="ABSOLUTE_PRIOR_BACKUP_SQLITE_PATH"` **locally** to compare owner password hashes without showing them, check record counts, and look for evidence. Without a trustworthy baseline, it cannot prove that a password was never changed.
5. An authorized operator can run `node scripts/revoke-compromised-access.mjs --db="ABSOLUTE_EXISTING_SQLITE_PATH" --confirm-revoke`. It makes an integrity-checked backup first; it revokes owner sessions and pending browser/email recovery links **without changing passwords or customer data**. It does NOT automatically generate or expose a replacement token. Run only once after confirming the database path. Your isolated test suite verifies the safety properties.
6. For the desktop Chrome demonstration, run **Watch RepairlyLabs Test in Chrome.cmd** by double-clicking it in an active Windows desktop, or `python tests/isolated_visible_lifecycle.py` in an interactive Windows terminal. It uses a temporary test database and port 3005. A cloud agent cannot place the window onto the real Windows monitor without an interactive desktop capability.
7. The old `master_browser_audit.py`, `master_visible_suite.py` and other legacy scripts were changed into isolation-first wrappers so they cannot accidentally submit synthetic customer records to a live port 3001 database.
8. Browser screenshots/traces often include access codes. They are stored under `test-results/` and are **excluded from Git**. Never publish them without a full secret and personal-data review.

## Git history and secret exposure

Use `node scripts/sanitize_check.mjs --history` inside the **original local Git checkout**, not a ZIP extraction. It prints only locations and categories, never secrets. Its heuristics cannot prove absence of all secrets. If a real secret has ever been committed, immediately revoke/rotate it with its provider; removing a file from the latest commit does not remove exposure from history, forks or caches.

## Evidence classification

- **PASS:** executed in this sandbox.
- **PASS (MOCK):** exercised against a local synthetic fixture or mocked provider; not a real financial transaction.
- **BLOCKED:** required data, Git history, Windows desktop, or external provider access unavailable here.
- **NOT TESTED:** not run.

No deployment, Git push, remote secret rotation, live payment, external WhatsApp or actual bank validation was performed by this offline process.
