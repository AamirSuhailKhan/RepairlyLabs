# RepairlyLabs hosting safety check (November 2026)

**This release must run on a persistent Node.js server, not Vercel Functions.**

The uploaded version included a Vercel adapter plus a `/tmp/data` SQLite fallback. Vercel Functions have ephemeral writable storage. A successful API health check does **not** prove database persistence. Admin accounts, bookings, orders, payment verification, recovery links and inventory can be lost or diverge across invocations.

## What this update changes

- `api/index.mjs` refuses requests on Vercel (`503 PERSISTENT_HOST_REQUIRED`) **before the application module initializes SQLite**. This deliberately prevents accepting customer/payment data into disposable storage. It is not a production payment solution for Vercel.
- `tests/vercel_serverless.test.mjs` checks the fail-closed behavior, even with `REPAIRLYLABS_TEST=1`.
- `tests/run_live_browser_suite.py` no longer contains a hardcoded owner password, fixed local project path or production data reference. It invokes the isolated browser smoke test instead.

## Supported deployment for the existing architecture

Use the included `deploy/compose.yml` + Caddy, or the systemd + Caddy instructions in `docs/DEPLOYMENT.md` with:

- A real persistent volume for `DATA_DIR` (not `/tmp`), owned by the application user.
- One Node.js process against SQLite, or a fully tested upgrade to a managed database for horizontal scaling.
- HTTPS, `PUBLIC_ORIGIN`, correctly configured trusted proxy, owner credentials, and secure offsite SQLite backups.
- Real business details and verified QR recipient; manual bank-credit verification for static UPI QR.
- Isolated local browser tests, Razorpay sandbox verification, and SMS/WhatsApp provider tests prior to accepting customers.

If you must host the *frontend* on Vercel, a real durable backend and database must be separately hosted, with explicit API origin, CORS/cookie design and trusted callback settings. This code does not implement that split architecture.

## Tests

Run `npm test`, `npm run audit` and `python tests/browser_e2e.py`. The browser test requires a working Playwright/Chromium environment; a failure caused by an administrator's localhost navigation policy is not a passing UI test.
