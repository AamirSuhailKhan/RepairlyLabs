# RepairlyLabs 1.2.0 — findings closure and launch checklist

Basis: the supplied `RepairlyLabs-main (3).zip` and `Pasted text(20261120-150146).txt` (the earlier findings report). This is an incremental full-source upgrade of that exact archive, not a fresh website. No real database, owner credentials, merchant QR or provider credentials were included in the uploaded archive. Keep them in your existing installation.

## Confirmed findings from the original report

| Finding | Closure status |
|---|---|
| Definite provider create-order rejection leaves payment stuck | Existing fix retained, mocked regression passes. Unknown outcomes remain locked for safety until reconciled, not blindly retried. New scheduled reconciliation checks known open orders only. |
| Stuck cash payment and cancellation after definite failure | Existing recovery tests retained. For unknown provider outcomes the lock is intentional until operator reconciliation. |
| Technician settings change and customer export | Existing authorization restrictions retained; tests pass. |
| Legacy admin directly completes repair | Existing restriction retained; authorization/legacy state rechecked after request body arrives. |
| Invalid appointment calendar dates | Existing validation retained; capacity/time-slot availability is still not implemented. |
| Duplicate form submission | Existing booking fingerprint and high-entropy retry keys retained; parts form retry now returns original private order code only if it has not been replaced. Distinct requests can still be separate valid orders. |
| Partial failed model import | Existing all-or-nothing implementation retained. |
| Missing contact falsely returns success | Existing 404 fix retained. |
| 12-vs-8-character documentation | Corrected main README and .env example to eight-character minimum; long unique passwords recommended. |
| Inconsistent database configuration | Existing central config retained; backup integrity and isolated restore check added. |

## New work in this release

- Static UPI QR payment for **spare-parts orders** using the same merchant QR settings and `rl_payments` ledger as repairs. Customer receives 43-character private access code on checkout, not just phone-number tracking. Legacy orders are compatible: owner can issue a private code without modifying order records. Customer portal: `/parts-payment/`; owner/accountant desk: `/parts-payment/?admin=1`. Customer access and bill details are validated on the server.
- QR claims are unverified until staff checks actual bank credit. Owner/accountant only for manual payment review, cash and actual offline refund recording before fulfillment. Payment screenshots are private database values; they are not proof of receipt. Duplicate pending/verified UTRs rejected across repairs and parts. Pending claims prevent cancellation; verified payments must be refunded before cancellation. When a pending parts order is confirmed with QR enabled, its full verified listed subtotal must be settled before it is completed. Legacy and QR-disabled orders retain the historical request-only compatibility behavior; if a cash/QR payment is recorded they become payment-controlled. Delivery charges and separate fees are not collected by this feature. No silent changes to historic records.
- Shared financial overview includes both request types, gross verified credits, refunds and net receipts for today (IST), seven days, month and all time. Download CSV ledger (amounts in integer paise). This is not an accounting profit report or gateway settlement report. Owner/accountant only. Payment claims and recorded cash/refunds queue owner notifications through existing provider logic.
- Verified owner email password recovery: Security > Configure verified email recovery. Owner must first sign in and verify the mailbox via a current-password-authorized, expiring email link. Configure `PUBLIC_ORIGIN` (actual HTTPS domain), `RL_RESEND_KEY`, and `RL_FROM_EMAIL` using your verified provider sender. Public reset only works for the verified email; tokens are hashed, single-use and expire after 15 minutes; resend cooldown and rate limits. Changing email invalidates verification. Reset revokes sessions and existing offline/operator recovery codes; save new offline codes after signing in. No public admin registration. Existing trusted operator recovery remains for first time or if recovery was never enabled. Provider tests are mocked, not real email sends.
- Active-session display and sign-out-other-sessions operation; owner recent activity view (latest 100). No raw session hashes returned. Added reauthorization after async admin request reads, and preserved technician assignment when saving diagnosis.
- Scheduled gateway reconciliation polls known open Razorpay orders every 60 seconds, up to 10 each run; only captured, amount/currency/order-matched transactions settle. No new charges or blind retries. If creation outcome is unknown, use existing owner review with actual provider evidence. Automatic refunds and provider order closure are not implemented.
- Server-rendered `/service/<slug>` and `/part/<id>` catalog pages, sitemap.xml with configured HTTPS domain, canonical links and private-page noindex headers. Only verified active parts included; no fake shop information. Main storefront remains SPA. This is initial SEO, not full SEO optimization.
- `npm run backup` creates and checks a SQLite-consistent copy. `npm run restore:check -- <backup.sqlite> <new-empty-dir>` verifies and copies into a separate directory, never the active database. Restore test uses synthetic data only. Offsite backup encryption/scheduling still needs setup.

## Verified tests

See `TEST-RESULTS-1.2.0.txt`. 16 automated Node tests passed, 23/23 functional audit checks passed. New tests cover private order code and retry, parts claims, shared UTR uniqueness, parallel duplicate claims, roles, bank-review confirmation, refunds, unpaid completion guard, stock restoration, owner notifications queued, financial access/export, email recovery with a mock provider, scheduled gateway reconciliation (mock), backup restore, sitemap and selected static routes. JS syntax checks passed. Chromium's managed policy explicitly blocks all URL navigation in this environment; no visual or real-browser E2E pass is claimed. Windows recovery launcher and live external providers not verified. No live financial transactions performed.

## Not yet closed from the broader report (do not call these finished)

| Report area | Remaining work |
|---|---|
| Payment | Dynamic/gateway QR issuance, automatic bank confirmation, gateway refund APIs, disputes/settlements, payment expiry for known open provider orders, post-delivery accounting adjustments, GST configuration/invoices and generated downloadable PDF (current statements printable/save as PDF). Customer can still make transfers outside the site; merchant must reconcile any unclaimed or duplicate bank credits. |
| Repair logistics & customer | Device intake photos, complete physical pickup/delivery dispatch, capacity appointment scheduling, multiple issue selectors, verified customer phone OTP / accounts and history, cancellation/rescheduling portal, serviceability rules, dedicated warranty management and exceptions for failed repair / parts unavailable. Existing repair stages and QR payment remain functional. |
| Inventory | Supplier records, purchase orders, purchase costs/profit accounting, batch/serial tracking, reservations, returns, actual product photos and bulk product import. Existing SKU linked repair stock deduction remains. |
| Authentication | Optional MFA, pickup/delivery role, verified customer authentication, individual device session details. Email provider and owner verification needed for live browser recovery; local first-time recovery needs trusted operator. |
| Communications | Actual customer WhatsApp template integration, delivery status callbacks, contact preference granularity, live provider verification; owner events and optional repair customer email remain. |
| Storefront | Actual business info, workshop photos, verified reviews/real warranty, comprehensive metadata and structured data, Hindi translation, conversion analytics, accessibility and browser performance verification. |
| Deployment | Persistent distributed rate limit, fully versioned migration framework, retention policy/automation, offsite encrypted backups and production monitoring, real HTTPS and live deployment tests. Current single-server SQLite design retained. |

## Installation for the coding agent

1. Back up existing source and actual configured SQLite database, stop the correct running server, integrate all source files from this archive. Preserve existing `.env` and live `data` directory (or external DATA_DIR). Never overwrite live data with test fixtures. Additive migrations run on startup. The archive has only `data/.gitkeep`.
2. Use Node 22.13+ and start actual existing app; agent runs tests, no daily owner terminal commands. Confirm login in actual local browser. Existing credentials remain unchanged. If inaccessible use the trusted agent recovery script from actual server project and database or configured verified email / previously saved recovery codes. Do not share passwords or tokens in chat.
3. Admin > Repair Desk > UPI QR settings: upload actual merchant QR, verify recipient, and re-enter owner password. This is a manual bank-verification payment workflow. Razorpay remains optional with real test credentials and signed webhook setup.
4. Admin > Parts orders to confirm stock and price. Owner/accountant > Parts payment desk to review claims. Customer accesses via private code from checkout; for old orders owner may replace code privately. Review all fulfillment and financial exceptions before rollout.
5. Configure actual HTTPS domain, Resend sender/credentials if desired, optional notifications, business information, real verified inventory, backup storage and alerts. Run live test transactions in provider test mode and local real-browser E2E. Do not run real charges for code testing.

This release addresses the reproducible critical findings and additional gaps above. It is not a claim of full implementation of the report's broader wishlist or production certification.
