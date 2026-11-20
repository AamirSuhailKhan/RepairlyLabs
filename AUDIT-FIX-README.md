# RepairlyLabs — audit fixes (2026-11-20)

Based on the uploaded RepairlyLabs-main (1).zip, commit 69db622204699b54e0e384eecec69f43c5be91bb. Not a replacement for newer local changes. Back up the existing project and consistent SQLite database before merging; retain .env and data. This archive contains no real customer database or credentials.

## Changes
- Repair Desk directory routes now load its own HTML with the same Razorpay-scoped CSP as the explicit index.html route. Inline navigation script moved into external app.js. Google Fonts allowed on that page; no unsafe-inline JavaScript added.
- Owner recovery, setup, team creation/reset and password change accept 8–150 characters. Prefer a unique long password. Browser recovery uses a single-use expiring operator-issued link. Agent script validates token against the running server before returning it, to catch incorrect database/server configuration. Existing accounts are not overwritten on server startup.
- Server resolves database directory relative to project root; agent likewise changes working directory to project root. Preserve the actual DATA_DIR in the existing installation.
- Proxy rate limiter uses rightmost valid forwarded IP only from explicitly trusted loopback proxy and bounded storage; full scheme/host origin comparison. Configure PUBLIC_ORIGIN for HTTPS reverse proxy deployments. TRUST_PROXY=1 only for one trusted loopback proxy that overwrites/appends correct peer IP and direct backend is private. Docker bridge addresses are not implicitly trusted; configure proxy architecture and verify rate limits before deployment.
- Pagination values sanitized; invalid cart/import/quote rows return validation errors; prototype-inherited export keys rejected; request bodies preserve UTF-8 across chunks. Cart quantity cap and distinct item cap match backend. Tracking link prefills repair reference, not private token.
- Customer repair API no longer exposes existence via differing unauthenticated status for missing job; signed malformed capture webhook rejected; payment reconciliation checks provider order ID; invalid gateway JSON fails closed. Ambiguous provider order creation failure intentionally requires reconciliation to avoid charging twice. No automatic refund implementation added.
- JS/CSS revalidate on refresh and asset version changed.

## Run by coding agent (not manual user commands)
1. Back up existing code and consistent SQLite DB, verify actual project and DATA_DIR. Merge this ZIP without deleting existing data/.env. Check differences from any newer local changes.
2. Restart the correct server after stopping obsolete instance on the configured port. For local recovery, agent executes `node scripts/agent-owner-recovery.mjs` from the project. If no database exists yet, first start the server to initialize it. Keep output private (contains short-lived token); open the URL in the user's local browser. User chooses email/password directly, never in chat. No CMD or VBS launcher needed.
3. After saving recovery, sign in at /admin; verify /repair-center/?admin=1 and customer portal /repair-center/. Verify with actual existing records and test user account. Do not expose owner setup publicly; no email-based recovery added.
4. Run `npm test` and `npm run audit`. In real local Chrome verify login, refresh session, logout, booking and tracking, quote/approve, checkout and invoice. Use Razorpay test credentials and signed webhook, not real money, before going live.

## Verification in this environment
- Node 22.16.0: 10/10 npm tests passed (9 originals plus regression suite).
- 23/23 existing audit checks passed.
- New test checks route/CSP headers and no inline script, 8-character password, short password rejection, recovery-check validity and invalidation, malformed data, pagination, spoofed forwarded-for rate limits, scheme mismatch, signed malformed webhook and unauthorized job lookup.
- Attempted real Chromium with Playwright; navigation denied by browser administrator policy (ERR_BLOCKED_BY_ADMINISTRATOR). No browser E2E success claimed. Windows launcher and live gateway/notifications not verified. The screenshots do not list all eight findings, so this is not a claim that every finding in that other audit is addressed. Payment provider errors, partial/failed payments, proxy deployment and production backup/restore still require deployment-specific verification.
