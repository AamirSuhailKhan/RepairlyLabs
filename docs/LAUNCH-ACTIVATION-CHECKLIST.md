# Launch Activation Checklist (Owner Action Plan)

All application features, database integrity protections, automated tests, and reverse-proxy deployment templates are implemented. Complete the steps below **in exact order** when you are ready to go live with your external accounts and domain.

---

## Step 1 — Domain, DNS & Production Server Environment

1. Point your domain A/AAAA DNS records to the VPS IP address.
2. Set `PUBLIC_ORIGIN=https://your-real-domain.com` in `.env` (must start with `https://`, no trailing slash).
3. Set `NODE_ENV=production`, `TRUST_PROXY=1`, and `TRUST_PROXY_CIDRS` matching your proxy setup (`172.16.0.0/12` for Docker Compose or `127.0.0.1/32` for local host Caddy).
4. Generate secrets in `.env` (`chmod 0600 .env`):
   - `RL_BACKUP_KEY=$(openssl rand -hex 32)`
   - `RL_MFA_KEY=$(openssl rand -hex 32)` (if authenticator MFA will be enabled)
5. Replace `:80` / placeholder domain inside `deploy/Caddyfile` with your real domain so Caddy provisions TLS certificates automatically.
6. Ensure `REPAIRLYLABS_TEST` and `KASHIFIX_TEST` are **unset**.

---

## Step 2 — Owner Account, Legal Policies & Business Settings

1. Provision your live owner login on the server (`npm run setup` or temporary one-time recovery link). Never reuse test/demo passwords.
2. Open `/admin` -> **Site settings** and fill real verified information:
   - Business name, real workshop address, hours, customer phone, support email, and Google Maps URL.
   - Review customer-facing **Service terms**, **Warranty policy**, and **Privacy contact**.
3. Open `/privacy` and `/terms` on the live site and review every section against your legal entity registration (`[OWNER TO CONFIRM BEFORE LAUNCH]` items listed in `docs/LEGAL-POLICY-DRAFTS.md` — confirm whether GSTIN applies or mark receipts explicitly as non-GST estimates/bills of supply).
4. Review seeded sample listings under `/admin` -> **Inventory**. Keep unverified placeholder items as `Sample listing = ON` or archive/replace them with real stocked parts.

---

## Step 3 — Bank Account & Manual UPI QR Setup (Optional / Before Razorpay)

1. Open `/admin` -> **Open Repair Desk →** -> QR payment settings (`POST /api/repair-center/admin/qr-settings`).
2. Enter your real **Merchant display name**, **Verified business UPI ID**, and upload your clean shop QR PNG/JPEG image (`enabled = 1`).
3. Keep `confirmed: true` bank statement verification discipline whenever approving customer UTR claims; RepairlyLabs never marks manual UTR claims captured automatically.

---

## Step 4 — Live Razorpay Integration & Webhooks (When Merchant KYC Completes)

1. In Razorpay Dashboard -> **Account & Settings -> API Keys**, generate **Live** `Key ID` (`rzp_live_...`) and `Key Secret`.
2. In Razorpay Dashboard -> **Webhooks**, create an endpoint pointing to:
   - `https://your-real-domain.com/api/repair-center/webhook`
   - Select events: `payment.captured`, `refund.created`, `refund.processed`, `refund.failed`.
   - Copy the Webhook Signing Secret (`RAZORPAY_WEBHOOK_SECRET`).
3. Add to `.env`:
   ```env
   RAZORPAY_KEY_ID=rzp_live_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   RL_GATEWAY_QR_ENABLED=1   # Set 1 only if Dynamic UPI QR is enabled on your merchant account
   ```
4. Restart the container/service cleanly and run a ₹10–₹50 supervised end-to-end live test (booking -> quote -> approve -> Razorpay checkout/webhook -> partial or full refund -> confirm ledger accuracy).

---

## Step 5 — Email, Phone OTP & WhatsApp Business (Optional / When Approved)

1. **Transactional Email (Resend)**: Add `RL_RESEND_KEY` and `RL_EMAIL_FROM` (using a verified sender domain) to `.env`. Needed for email account recovery (`/account-recovery/`) and customer notification outbox delivery.
2. **SMS OTP Verification (Twilio Verify)**: Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and set `RL_OTP_ENABLED=1` if enabling phone OTP portal access.
3. **WhatsApp Business Cloud API (Meta)**:
   - Configure approved WhatsApp Business account + system user token + Phone Number ID + Business template name in Meta Developer Console.
   - Store credentials in `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, and `RL_NOTIFY_WEBHOOK_URL` / `RL_NOTIFY_WEBHOOK_SECRET` if forwarding alerts to an external relay.

---

## Step 6 — Final Day-Zero Smoke Check

1. Verify `docker compose -f deploy/compose.yml ps` (or `systemctl status repairlylabs`) is healthy.
2. Run `node scripts/monitor-check.mjs https://your-real-domain.com`.
3. Enable `repairlylabs-backup.timer` and run a test `npm run backup` + `npm run restore:check` in a temp directory.
4. Confirm security headers externally: `curl -I https://your-real-domain.com` shows `Strict-Transport-Security`, `X-Frame-Options: DENY`, and `Content-Security-Policy` containing `frame-ancestors 'none'`.
