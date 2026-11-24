# Deploying RepairlyLabs (Production & Staging)

## Supported Architecture

RepairlyLabs is a zero-dependency Node.js (>= 22.13) ESM + built-in `node:sqlite` (WAL mode) application serving static assets and JSON/HTML APIs from `src/server.mjs`.

- **Recommended runtime**: Single Linux VPS (Ubuntu/Debian LTS, 1+ vCPU, 1–2 GB RAM, persistent NVMe/SSD) with Node 22/24 or Docker Engine + Caddy reverse proxy.
- **Persistent storage rule**: Keep `DATA_DIR` on a persistent local SSD outside the application checkout (`/srv/repairlylabs/data` or Docker volume `repairlylabs_data`). Multiple processes sharing one SQLite database over NFS/SMB are not supported.

---

## Option A — Docker Compose + Caddy Reverse Proxy (Recommended)

Deployment manifests are provided under `deploy/`:
- `deploy/Dockerfile`: Multi-layer Node 24 Bookworm-slim container (`node:24-bookworm-slim`), installs strictly via `package-lock.json` cleanly, sets non-root `node` user, exposes port `3001`, persists `/app/data`.
- `deploy/compose.yml`: Hardened production Compose service (`read_only: true`, `cap_drop: ALL`, `no-new-privileges`, `127.0.0.1:3001:3001` host loopback binding, `stop_grace_period: 15s`, healthcheck polling `/api/ready`, rotated JSON file logs).
- `deploy/Caddyfile`: HTTPS termination, security headers, HSTS (`max-age=31536000; includeSubDomains`), and reverse proxy to `127.0.0.1:3001`.
- `deploy/compose.staging.yml` and `deploy/Caddyfile.staging`: Isolated pre-production staging configuration (bound to `127.0.0.1:3002`, separate `repairlylabs_staging_data` volume).

### Trusted Proxy & Docker Bridge IP Handling

Never trust arbitrary `X-Forwarded-For` headers from public clients. `deploy/compose.yml` enables:
- `TRUST_PROXY=1`
- `TRUST_PROXY_CIDRS=172.16.0.0/12` (covers standard Docker bridge ranges alongside loopback `127.0.0.1` / `::1`)

When Caddy runs on the host or reverse-proxies over a Docker bridge network, `src/server.mjs`:
1. Verifies the TCP socket IP against loopback + `TRUST_PROXY_CIDRS` using Node `net.BlockList`.
2. Walks `X-Forwarded-For` from right to left, stripping known trusted proxy hops, so left-side header spoofing (`X-Forwarded-For: 1.2.3.4, <client-ip>`) cannot bypass rate limiters or audit attribution.
3. Restricts proxy-derived `https` detection to verified trusted proxy connections (`X-Forwarded-Proto: https`).

If you use a custom Docker subnet (e.g., `192.168.100.0/24`), override `TRUST_PROXY_CIDRS` in `.env` with that exact CIDR.

### Host Firewall (UFW)

Before starting Caddy, lock down inbound ports so external clients cannot bypass TLS/reverse-proxy rate limits by hitting Node directly:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP ACME redirect'
sudo ufw allow 443/tcp comment 'HTTPS via Caddy'
sudo ufw enable
```

Node binds strictly to `127.0.0.1:3001` inside `deploy/compose.yml`.

### Launch Sequence (Docker + Caddy)

1. Copy `.env.example` to `.env` (`chmod 600 .env`) and fill production values (`PUBLIC_ORIGIN=https://your-domain.com`, `RL_BACKUP_KEY=...`, optional gateway/notification credentials).
2. Create initial owner account cleanly without leaving recovery tokens in shell history (`npm run setup` or temporary container `docker compose -f deploy/compose.yml run --rm web node scripts/setup.mjs`).
3. Start production stack:
   ```bash
   docker compose -f deploy/compose.yml up -d --build
   ```
4. Update domain in `deploy/Caddyfile`, reload Caddy (`sudo systemctl reload caddy`), and verify readiness (`curl -fsS https://your-domain.com/api/ready`).

---

## Option B — Bare-Metal Linux + systemd

1. Place application source under `/srv/repairlylabs/app` and persistent data under `/srv/repairlylabs/data` owned by unprivileged system user `repairlylabs`.
2. Place `/srv/repairlylabs/app/.env` (`chmod 0600`) with:
   ```env
   NODE_ENV=production
   PORT=3001
   DATA_DIR=/srv/repairlylabs/data
   TRUST_PROXY=1
   TRUST_PROXY_CIDRS=127.0.0.1/32
   PUBLIC_ORIGIN=https://your-domain.com
   RL_BACKUP_KEY=<64-hex-chars>
   ```
3. Configure `/etc/systemd/system/repairlylabs.service`:
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
   TimeoutStopSec=15
   NoNewPrivileges=true
   ProtectSystem=strict
   ReadWritePaths=/srv/repairlylabs/data
   PrivateTmp=true
   [Install]
   WantedBy=multi-user.target
   ```
4. Reload and enable: `sudo systemctl daemon-reload && sudo systemctl enable --now repairlylabs`.

---

## Graceful Shutdown & Startup Checks

- **Startup environment validation (`src/config.mjs`)**: In `NODE_ENV=production`, startup aborts immediately if `REPAIRLYLABS_TEST=1` / `KASHIFIX_TEST=1` is set, if `PUBLIC_ORIGIN` is invalid or non-HTTPS, if `TRUST_PROXY_CIDRS` has invalid syntax, or if `RL_MFA_KEY` / `RL_BACKUP_KEY` is malformed (must be 64 hex chars).
- **Graceful shutdown (`src/server.mjs`)**: On `SIGTERM` or `SIGINT`, the server stops accepting new connections, allows active HTTP requests up to 10 seconds to drain cleanly, stops background reconciliation/outbox timers, and cleanly closes the SQLite connection (avoiding orphaned locks or partial responses during rolling restarts).

---

## Pre-Production Staging Deployment

Before deploying upgrades to production:
1. Point a staging subdomain inside `deploy/Caddyfile.staging`.
2. Deploy with `docker compose -f deploy/compose.staging.yml up -d --build`.
3. Confirm `/api/health`, `/api/ready`, `/terms`, `/privacy`, and admin sign-in work over HTTPS with `SameSite=Strict; Secure` cookies and `X-Frame-Options: DENY`.
