# Deploying RepairlyLabs (persistent Node + SQLite)

## Suggested VM configuration

A small Linux VPS with Node 24, 1 CPU / 1–2 GB memory, a persistent SSD, HTTPS reverse proxy and scheduled snapshots is sufficient for a low-traffic pilot. Keep `data/` outside the source folder on a persistent, backed-up filesystem.

Install Node 24, put the project under `/srv/repairlylabs/app`, create `/srv/repairlylabs/data`, then change ownership to the dedicated system user.

Place `.env` under `/srv/repairlylabs/app` (mode 0600). Example:

```env
NODE_ENV=production
PORT=3001
DATA_DIR=/srv/repairlylabs/data
TRUST_PROXY=1
```

Create an admin with `npm run setup`. Do not set insecure, easy-to-guess credentials or use the root account to run the server.

## Example systemd unit

Save as `/etc/systemd/system/repairlylabs.service` and adjust paths:

```ini
[Unit]
Description=RepairlyLabs mobile repair website
After=network.target
[Service]
Type=simple
User=repairlylabs
Group=repairlylabs
WorkingDirectory=/srv/repairlylabs/app
ExecStart=/usr/bin/node src/server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/repairlylabs/data
PrivateTmp=true
[Install]
WantedBy=multi-user.target
```

Run `sudo systemctl daemon-reload && sudo systemctl enable --now repairlylabs`, inspect logs with `journalctl -u repairlylabs -f`.

## DNS + HTTPS

Point the domain to your VPS. Install Caddy, replace the domain inside `deploy/Caddyfile`, configure Caddy to load it, open inbound 80/443, and firewall or bind the Node port so the internet cannot connect to it directly. Caddy will provision and renew a TLS certificate for eligible domains.

Production cookies require HTTPS. Never transmit admin credentials over public HTTP.

## Backup and disaster recovery

Run `npm run backup` daily and transfer backups to another machine or object storage under an appropriate encryption and access policy. Restore by shutting down the server and restoring the `.sqlite` file to `DATA_DIR`, then restart and run `PRAGMA integrity_check` with a SQLite tool. Also test restore operations regularly. Keep WAL/SHM alongside a live DB or prefer the provided `VACUUM INTO` backup script.

## Observability

Use `GET /api/health` for uptime checks. Configure server logs and webhook/automation logs. By default the app keeps admin audit entries for sign-ins and important actions. There is no central log shipping, monitoring stack, incident notification, or notification retry queue bundled.

## Scale and limitations

Recommended deployment is one Node process. Multiple replicas sharing one SQLite DB over a network filesystem are not a supported production architecture. For growth, move data to PostgreSQL, add a deployment migration system, background task queue, multi-employee role permissions and a tested incident response process.
