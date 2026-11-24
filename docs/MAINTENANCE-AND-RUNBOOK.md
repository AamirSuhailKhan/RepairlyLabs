# Maintenance, Monitoring & Operations Runbook

## 1. Health & Readiness Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | Public | Basic process liveness check (`{ ok: true }`) |
| `GET /api/ready` | Public | Verifies live SQLite read/write readiness + migration check before routing traffic |
| `GET /api/extended/monitor` | Owner Session | Operational telemetry without leaking secrets: DB size, WAL size, free disk space (`statfsSync`), backup count & latest backup timestamp, failed outbox notification count, pending `reconciliation_required` payment/refund count, and boolean provider readiness flags |

### External Uptime Script

Run `node scripts/monitor-check.mjs https://your-domain.com` via Uptime Kuma, cron, or monitoring hooks. It exits with code `1` on non-200 or DB readiness failures.

---

## 2. Routine Monitoring Thresholds

Check `GET /api/extended/monitor` (or Extended Operations `/operations/?admin=1` -> **System monitor**) regularly:

- **Disk free (`disk.free_bytes` vs `disk.total_bytes`)**: Alert when free disk drops below 15%.
- **WAL growth (`wal_size_bytes`)**: If WAL exceeds 50 MB without checkpointing, verify there are no stalled read transactions or long-running inspection scripts.
- **Latest backup (`backups.latest_backup_at`)**: Alert if no backup exists within the last 26 hours.
- **Reconciliation backlog (`reconciliation_required_count > 0`)**: Investigate via Section 4 below.
- **Failed notifications (`failed_notifications_count > 0`)**: Inspect `rl_outbox` / Extended Operations outbox table for misconfigured webhook/email/WhatsApp keys or transient upstream failures.

---

## 3. Log Rotation & Incident Diagnostics

- **Docker Compose**: Configured in `deploy/compose.yml` (`json-file` driver, max `10m` × 5 files). View via `docker compose -f deploy/compose.yml logs -f --tail=200 web`.
- **systemd + Caddy**: `journalctl -u repairlylabs -f` and Caddy access/error JSON logs under `/var/log/caddy/`.
- Never log `.env`, `Authorization` headers, cookies, private repair access codes, or raw payment webhooks publicly.

---

## 4. Payment & Refund Reconciliation Runbook

RepairlyLabs enforces transaction isolation and strict idempotency around Razorpay gateway calls:

1. **Dynamic QR (`state = creating` or `reconciliation_required`)**:
   - The background worker (`gateway-extensions.mjs`) polls unresolved `open` QR rows with saved `qr_id`.
   - If a crash occurred before `qr_id` saved locally, open `/operations/?admin=1` or Repair Desk and run **Link QR** (`POST /api/gateway-extension/:ref/link-qr` with `qr_id`) after confirming the `qr_...` reference matching `notes.reference` (`gqr_...`) in the Razorpay Dashboard.
2. **Gateway Refund (`state = reconciliation_required`)**:
   - Every refund attempt records `attempted_at` **before** calling Razorpay `POST /v1/payments/{id}/refund`.
   - On network timeout or local crash, `refund-check` / the 60-second background tick queries read-only `GET /v1/payments/{payment_id}/refunds` (matching `receipt`, `notes.receipt`, or unique `notes.reference` + `amount`) instead of blindly submitting a duplicate refund POST.
   - If Razorpay has created the refund (`rfnd_...`), use **Check refund status** or **Link provider refund (`rfnd_...`)** inside `/operations/?admin=1` (`POST /api/gateway-extension/:ref/link-refund`), or allow the verified `refund.processed` webhook to settle `rl_payment_adjustments` atomically.
   - Never call an off-ledger manual refund in Razorpay without recording it in RepairlyLabs, or total refund guards will mismatch.

---

## 5. Emergency Security & Access Recovery

- **Revoke all active staff/admin sessions immediately** if a laptop or phone is lost:
  - Logged-in owner UI: `/admin` -> **Security** -> **Sign out other sessions**.
  - CLI on server host: `node scripts/revoke-compromised-access.mjs`
- **Owner password reset** (requires server shell access):
  - `node scripts/agent-owner-recovery.mjs` (prints one-time 15-minute link; delete terminal logs afterward).
- **Backup key / encryption management**:
  - Rotate `RL_BACKUP_KEY` cleanly by storing the outgoing key alongside archived backups before generating a new `openssl rand -hex 32` key in `.env`.
