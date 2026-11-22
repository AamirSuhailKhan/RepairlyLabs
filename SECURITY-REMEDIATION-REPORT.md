# RepairlyLabs — Independent offline security & browser testing review

**Date:** 2026-11-22

## Scope and verified facts

- Latest three `RepairlyLabs-main (6)` archives were identical by SHA-256. The working source archive has no `.git` directory, `.env`, customer database, browser recordings or live Playwright traces.
- Existing application tests: **23/23 PASS** before changes.
- Modified application + new security regression tests: **25/25 PASS**.
- Existing functional audit: **23/23 PASS**.
- Browser E2E attempt in this sandbox: **BLOCKED**, `net::ERR_BLOCKED_BY_ADMINISTRATOR` before reaching `/admin`.
- Secret scanner: **NO MATCHES for configured high-confidence patterns** in the updated source; **Git history BLOCKED** (no `.git`). This does not prove there have never been leaks.
- Isolated recovery-token revocation, backup creation, owner-hash preservation and unrelated data preservation: **PASS (MOCK/ISOLATED)**. Test results available in `tests/security-remediation.test.mjs`.

## Corrections performed

1. Replaced legacy headed Chrome scripts that operated on the live port 3001 with wrappers invoking the isolated test runner on port 3005.
2. Restricted isolated Python test environments to explicit test-only variables and generated ephemeral test administrator passwords. Did not inherit production merchant or messaging credentials.
3. Corrected obsolete parts-enquiry test API endpoints and strengthened browser-script assertions; legacy suites cannot count a response as PASS merely because a page opened. **These browser assertions still require a permitted Windows run.**
4. Marked simulated UPI and cash verification as **MOCK**, not real bank settlement. The source report had overstated that distinction.
5. Replaced the previous sanitizer, which could print entire credential-containing lines, with a redaction-safe scanner for source and optional local Git history.
6. Added a read-only, no-PII database integrity/owner-hash comparison utility. It requires a real current database **and** a trusted baseline to determine whether the owner's password changed.
7. Added a fail-closed local operator revocation utility with a verified backup before deleting owner sessions and recovery links; no customer rows, owner password hashes, or account identifiers are changed.
8. Prevented running the bootstrap `npm run setup` on top of an existing admin account, which could previously replace its password using stale environment configuration.
9. Prevented `REPAIRLYLABS_TEST=1` being enabled in `NODE_ENV=production`.
10. Redirected the old `backup_db.mjs` script to the centralized DATA_DIR-aware backup utility.
11. Created a sanitized copy of the provided remediation report without recovery URL, customer phone or local user details.

## Ten requested requirements: evidence and remaining work

| # | Requirement | Result |
|---|---|---|
| 1 | Prove live owner password unchanged; browser reset; revoke live sessions | **BLOCKED** without actual database and a trusted earlier backup. Read-only verifier and tested operator revoker supplied; no live account was changed. |
| 2 | Remove secrets; Git history; invalidate leaked keys | **PARTIAL** updated source and supplied report sanitized, safer scanner supplied. No `.git` history and no provider access; real exposed tokens must be revoked locally. |
| 3 | Preserve business DB and classify synthetic test data | **BLOCKED** on real DB. No actual records deleted; read-only audit tool supplied. Earlier reported ID ranges are candidates, not independent proof. |
| 4 | Show actual Chrome on Windows desktop | **BLOCKED** by physical desktop isolation; interactive-only local runner supplied. |
| 5 | Run repair lifecycle visibly in Chrome | **BLOCKED** in sandbox; automated backend regression coverage exists; local visible script corrected but not executed here. |
| 6 | Verify parts payment, refunds and permissions | **PASS (MOCK/ISOLATED)** in existing Node test suites; **NOT TESTED live provider/browser**. |
| 7 | Separate test DB and test-only payment credentials | **PASS** code review and isolated regression; Python runner now uses temporary DB and does not inherit production API keys. |
| 8 | Capture physical Windows Chrome desktop | **BLOCKED**: cannot access user's Windows desktop from this environment. No screenshot falsely claimed. |
| 9 | Regressions with accurate statuses | **PASS** 25/25 Node tests, 23/23 audit; Chrome **BLOCKED**, live integrations **NOT TESTED**. |
| 10 | Preserve existing data, no deploy/push | **PASS** for actions in this environment: changed extracted source only, no live DB accessed, no Git push or deployment. |

## High-priority operator follow-ups

- Treat the recovery URL that appeared in the previous chat/report as **compromised**. Do not reuse or forward it. Run the operator revoker locally against the right database (with the verified backup), and use verified-email or a **new private** local owner-recovery flow.
- If the test password shown in an earlier report was ever used for the real owner account, change it and revoke sessions. The report alone cannot prove that it was not.
- Verify actual data against a backup. Do **not** delete IDs by numeric range until candidate synthetic records are confirmed individually and relational dependencies are assessed.
- Inspect the real Git repository history before claiming the remote is free of leaked secrets; rotate exposed provider keys where needed.
- For bank, WhatsApp, OTP and Razorpay, obtain receipts/test-mode provider acknowledgments. The current repository tests use synthetic fixtures and mocked responses only.

## Browser evidence

Available: console log of a genuine Playwright navigation attempt showing `ERR_BLOCKED_BY_ADMINISTRATOR`; browser source tests and a local Windows execution script.

Not available: a physical desktop screenshot or watchable recording from the user's Windows monitor in this environment. Do not use Playwright page screenshots as a substitute for that proof.
