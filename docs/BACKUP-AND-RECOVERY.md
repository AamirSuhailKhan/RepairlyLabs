# Backup, Encryption & Disaster Recovery Guide

RepairlyLabs stores operational data, audit ledgers, and customer repair records inside SQLite (`DATA_DIR/repairlylabs.sqlite`) in WAL mode. Copying a live SQLite file directly without coordinating `-wal` and `-shm` files can corrupt backups; always use the bundled scripts.

---

## 1. Consistent Encrypted Backups (`scripts/backup.mjs`)

`npm run backup` executes SQLite `VACUUM INTO` to produce an atomic point-in-time snapshot, validates both `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, optionally encrypts it with AES-256-GCM, syncs it to a configured offsite folder, and prunes older snapshots.

### Key Environment Variables (`.env`)

| Variable | Purpose | Example |
|---|---|---|
| `DATA_DIR` | Live SQLite location | `/srv/repairlylabs/data` |
| `RL_BACKUP_KEY` | Optional 64-char hex AES-256 key (`openssl rand -hex 32`) | `<64 hex chars>` |
| `RL_BACKUP_OFFSITE_DIR` | Optional mounted offsite/NAS/rclone sync folder | `/mnt/offsite/repairlylabs-backups` |
| `RL_BACKUP_RETENTION` | Number of local backups to retain (default `14`, override via `--keep=N`) | `14` |

When `RL_BACKUP_KEY` is set:
- Backups are written as `repairlylabs-<timestamp>.sqlite.enc` using AES-256-GCM (`RLBK\x01` magic + 12-byte IV + ciphertext + 16-byte auth tag).
- The unencrypted staging `.sqlite` snapshot is deleted unless `--keep-plain` is explicitly passed.
- Store `RL_BACKUP_KEY` securely in your password manager separately from offsite storage so encrypted backups remain recoverable if the primary VPS is lost.

---

## 2. Automated Daily Backups (systemd)

Ready-to-customize unit templates exist in `deploy/repairlylabs-backup.service` and `deploy/repairlylabs-backup.timer`:

```bash
sudo cp deploy/repairlylabs-backup.service /etc/systemd/system/
sudo cp deploy/repairlylabs-backup.timer /etc/systemd/system/
# Edit EnvironmentFile / WorkingDirectory if needed
sudo systemctl daemon-reload
sudo systemctl enable --now repairlylabs-backup.timer
sudo systemctl list-timers repairlylabs-backup.timer
```

Run a manual test backup at any time:
```bash
sudo systemctl start repairlylabs-backup.service
sudo journalctl -u repairlylabs-backup.service -n 30
```

---

## 3. Isolated Restore Verification Drill (`npm run restore:check`)

Test restores regularly into a fresh temporary directory—never overwrite the live database during verification:

```bash
TMP_RESTORE=$(mktemp -d)
npm run restore:check -- /srv/repairlylabs/data/backups/repairlylabs-2026-11-24T00-00-00-000Z.sqlite.enc "$TMP_RESTORE"
# Inspect tables / record counts if desired:
node -e "import {DatabaseSync} from 'node:sqlite'; const db = new DatabaseSync('$TMP_RESTORE/repairlylabs.sqlite', {readOnly:true}); console.log(db.prepare('SELECT COUNT(*) jobs FROM rl_jobs').get());"
rm -rf "$TMP_RESTORE"
```

---

## 4. Full Recovery Procedure (Production Outage or Corruption)

1. **Stop the web server** so no writes occur during recovery:
   ```bash
   sudo systemctl stop repairlylabs
   # OR for Docker: docker compose -f deploy/compose.yml stop web
   ```
2. **Preserve the broken live DB** for post-mortem inspection:
   ```bash
   mv /srv/repairlylabs/data/repairlylabs.sqlite /srv/repairlylabs/data/repairlylabs.sqlite.broken.$(date +%s)
   rm -f /srv/repairlylabs/data/repairlylabs.sqlite-wal /srv/repairlylabs/data/repairlylabs.sqlite-shm
   ```
3. **Decrypt & verify** the target backup into a clean staging directory:
   ```bash
   mkdir -p /srv/repairlylabs/restore-staging
   npm run restore:check -- <backup-file-or-.enc> /srv/repairlylabs/restore-staging
   ```
4. **Move the verified file into place** with correct ownership/permissions:
   ```bash
   mv /srv/repairlylabs/restore-staging/repairlylabs.sqlite /srv/repairlylabs/data/repairlylabs.sqlite
   chmod 0600 /srv/repairlylabs/data/repairlylabs.sqlite
   chown repairlylabs:repairlylabs /srv/repairlylabs/data/repairlylabs.sqlite
   ```
5. **Restart and smoke-check**:
   ```bash
   sudo systemctl start repairlylabs
   node scripts/monitor-check.mjs https://your-domain.com
   ```

---

## 5. Schema Migration & Upgrade Rollback Strategy

- Additive schema updates are tracked in `schema_migrations(version, name, applied_at)`.
- **Before every release deployment**: run `npm run backup` first and inspect `Backup: <path>`.
- **If a release regression occurs after upgrade**: stop the service, restore the pre-upgrade snapshot via Section 4 above, checkout/deploy the previous container tag or code commit, and verify `/api/ready`.
