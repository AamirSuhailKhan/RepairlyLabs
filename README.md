> **Windows browser login update:** See [ACCESS-README.md](ACCESS-README.md) for double-click startup and secure owner recovery, email/username sign-in, and browser-based team management. No daily terminal setup required.

# RepairlyLabs — Mobile Repair & Spare Parts Website

An animated, responsive **full-stack repair and spare-parts storefront**. The working website includes a public customer experience, persistent SQLite database and protected operations dashboard.

**No `npm install` needed.** The source uses built-in JavaScript, CSS and Node.js APIs; it has no runtime npm dependencies. Use **Node.js 22.13+ (Node 24 LTS recommended)**. Node 22 may display an informational `node:sqlite` experimental warning.

> **Important:** The 20 starter part listings and their prices/stock are **illustrative**, not verified inventory. This app accepts part and repair **requests**, not online payments. A live business must first replace those examples, confirm its real contact details, terms and service arrangements, and deploy to an HTTPS domain.

## What is included

- Premium dark hero with CSS phone art, orbital animation, glow, floating badges, brand marquee, scroll-triggered reveals, responsive navigation and accessible reduced-motion fallback.
- Varanasi-focused service pages: display, battery, charging, water-damage assessment, camera, speaker, software and back panel.
- **19 brands / 215 phone models** seeded for brand/model suggestions, plus free-form input for unlisted models and an admin bulk model importer. Device names are suggestions, not a claim of universal service or verified compatibility.
- Searchable spare-parts catalog, brand/category/model filters, item details, cart and no-payment order requests. 20 demo inventory items. `sample` items cannot be confirmed in admin until marked verified.
- Repair request forms with booking preferences, Varanasi locality suggestions, optional requested date, reference creation and progress tracking.
- Contact form, privacy notice, required contact consent, stored consent timestamp, rate limiting, honeypot field, tracking with reference plus customer phone.
- Private admin console with dashboard, booking statuses and quote, order statuses and inventory deduction/restoration, inventory and services editor, model importer, contact inbox, site settings, password change and CSV exports.
- Real SQLite database using WAL, server-side input validation, scrypt password hashing, random HTTP-only admin sessions, CSRF token checks, origin checks, and response security headers.
- Optional outbound signed webhook to connect Make, n8n or Zapier for team alerts or customer status messages (provider not included).
- Automated API smoke tests, database backup script and Docker/Caddy deployment examples.

## Start locally (Windows / macOS / Linux)

### 1. Install Node.js

Install Node.js **v22.13 or newer** from https://nodejs.org/ (Node 24 LTS is recommended). Check with `node -v`.

### 2. Unzip the project

Open a terminal inside the project folder. In Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm run setup
npm start
```

In macOS / Linux:

```bash
cp .env.example .env
npm run setup
npm start
```

`npm run setup` asks for an administrator username and a **strong password of at least 8 characters (a longer unique password is recommended)**. It securely hashes the password into your local database. The website seeds its starter devices and sample parts automatically. Do **not** publish your real `.env` file or the `data/` folder.

### 3. Open the site

- **Website:** http://localhost:3001
- **Team dashboard:** http://localhost:3001/admin
- **Health check:** http://localhost:3001/api/health

For hot reload in development, run `npm run dev` instead of `npm start` (Node server restarts on changes; refresh browser for HTML/CSS changes).

### 4. Test the application

```bash
npm test
```

The automated test creates its own temporary database and checks core public/admin API workflows. It does not modify your business database.

## Configure the store before launching

1. Go to **/admin → Site settings**. Set your **real name, contact number, WhatsApp, real workshop address (if you have one), operating hours, service city and business terms**.
2. Go to **Inventory**. Edit or remove demo products. Enter real SKUs, model variants, real available stock, correct selling prices, component grade and part descriptions. Set **“Sample listing?” to “No — verified live listing”** only after checking the listing. Only verified items can have orders confirmed.
3. Go to **Services** to change repair descriptions and what your team actually offers. Disable pickup or delivery if not currently available.
4. Go to **Phone models** to bulk-import additional devices. A model can also be entered manually on the public booking form.
5. Review the **Privacy notice**, terms and warranty wording. Adapt to your actual business practices and obtain local legal advice if necessary.
6. Test the whole customer journey on your phone: booking, contact, parts request, tracking, and admin status updates. Arrange a process to respond promptly to requests. The dashboard saves submissions; it does not send SMS/WhatsApp by itself.
7. Set up a domain, HTTPS/TLS, database backups, access controls, and a privacy/data-retention process before opening to real customers.

## How orders work

1. Customer adds displayed parts and submits a **request** with a phone number and locality. No money is collected, and the listed subtotal excludes unquoted delivery/taxes/other fees.
2. Owner receives the request in **/admin → Parts orders**. Owner verifies exact device variant, part grade, stock, warranty, price and method of fulfillment with customer.
3. Owner updates product inventory from sample to verified. On changing an order from **Pending → Confirmed**, the server ensures all parts are active, verified, priced the same as originally requested, and available. It then deducts stock in one transaction.
4. Owner may advance to `in_progress → ready → completed`. Cancelling a confirmed/in-progress/ready order restores stock; completed orders cannot be cancelled through the status UI.
5. Customers can check status using **Track request**, entering reference `RLP-...` (part) or `RLM-...` (repair) and their original phone number (older `KP-...` and `KM-...` references remain supported).

**If the price changes after submission**, contact the customer, cancel the old request, and ask them to submit a fresh order after updating the product listing. Avoid collecting payment based only on the example website total.

## How to know when someone contacts you

- Every message is stored under **/admin → Messages**. Repair requests are under **Repair requests** and part requests under **Parts orders**.
- For team email / automation alerts, set a notification webhook in your local `.env`. The app POSTs JSON for `repair.requested`, `parts.requested`, `contact.received`, `repair.status_changed` and `parts.status_changed`.

```env
NOTIFY_WEBHOOK_URL=https://your-automation-provider.example/your-webhook
NOTIFY_WEBHOOK_SECRET=your-long-unique-shared-key
```

Each request is JSON with `event`, `record`, `timestamp`, and a `X-RepairlyLabs-Signature: sha256=<hex>` header (HMAC SHA-256 of the raw body). Configure Make / n8n / Zapier or your own endpoint to consume it. The app logs webhook failures but **does not retry**. For critical delivery guarantees, add a durable event queue and provider-level retries. Keep the receiver private and protect customer information. **No WhatsApp Business API or email provider is preconnected.**

## Production deploy

Use a small persistent Node server (VPS, cloud VM, container with attached persistent disk). **Do not deploy the SQLite database onto ephemeral serverless storage.**

### Example: VPS with Caddy HTTPS reverse proxy

1. Point DNS `A` / `AAAA` records for your domain to the VPS.
2. Install Node v24, extract the code, configure `.env` with `NODE_ENV=production`, `PORT=3001`, `DATA_DIR=/absolute/persistent/path`.
3. Run `npm run setup`, then run `npm start` as a dedicated non-root service account (systemd example in `docs/DEPLOYMENT.md`).
4. Install Caddy and use `deploy/Caddyfile` after replacing `your-domain.example`.
5. Only expose ports 80/443 publicly. Protect port 3001 from direct public access.
6. Set `TRUST_PROXY=1` **only if** you have a trusted local reverse proxy; otherwise leave it unset.

`NODE_ENV=production` sets the admin session cookie's `Secure` flag and HSTS, so log in over **HTTPS**.

### Docker

Use `deploy/compose.yml` and `deploy/Dockerfile`. The database is stored on the named Docker volume. Before first launch, run an interactive setup container:

```bash
docker compose -f deploy/compose.yml run --rm -it web npm run setup
docker compose -f deploy/compose.yml up -d
```

Put HTTPS in front of the container. The compose example binds port 3001 to **127.0.0.1** to avoid publishing the app directly.

## Backups

```bash
npm run backup
```

This creates a consistent SQLite `VACUUM INTO` backup under `data/backups` (or `$DATA_DIR/backups`). Keep copies off-server. Set up scheduled backups and test restores.

## Folders

```text
repairlylabs/
├── public/
│   ├── index.html, app.js, styles.css, manifest.webmanifest
│   ├── assets/favicon.svg
│   └── repair-center/    # Customer portal & Live Repair Desk
│       ├── index.html, app.js, style.css
├── src/
│   ├── data.mjs          # schema, seed, security helpers
│   ├── repair-reference.mjs # unique non-reusable reference ID generator
│   ├── repair-center.mjs # quotes, approvals, live inbox & Razorpay payments
│   └── server.mjs        # API, static server, auth, status workflows
├── scripts/
│   ├── setup.mjs         # first admin account
│   └── backup.mjs
├── tests/
│   ├── intake.test.mjs   # reference reservation tests
│   ├── repair-center.test.mjs # repair lifecycle & payments
│   ├── smoke.test.mjs    # customer + admin journeys
│   └── audit_suite.mjs   # 23-point security audit
├── deploy/
├── docs/
├── data/                 # ignored, persistent SQLite DB created on first boot
├── .env.example
├── .env.addon.example
└── package.json
```

## Known limitations / honest launch checklist

- **Not a real warehouse feed:** no supplier inventory, OEM integration, marketplace sync or guaranteed nationwide phone compatibility. Models are seeded suggestions and the inventory is demonstrative.
- **Not an automatic technician or diagnostic engine:** repairs are manually assessed and quoted by a real team.
- **Payment processing:** RepairlyLabs V2 includes integrated Razorpay payment gateway support for repair advance deposits and final balances (requires configuring your Razorpay API keys in `.env`).
- **No automatic SMS, email or WhatsApp notifications by default:** optional webhooks, Resend email and WhatsApp Meta Cloud API can be connected via `.env`, but delivery and consent requirements must be configured by the business.
- **No customer login, multi-employee roles, invoicing/GST logic, multi-branch inventory, shipping-rate integration, or return/refund workflow**. These are separate modules if the operation requires them.
- **Single-instance SQLite recommended.** For high traffic or multiple servers, migrate to PostgreSQL with migrations and a proper deployment pipeline.
- **Privacy/legal text is a starter**, not legal advice. You need to establish an accurate retention schedule and required policies for your business.

The code works locally and is deployable after configuration; a successful launch additionally depends on real business verification, HTTPS hosting, and operational setup.


## Latest upgrade
See `REPORT-CLOSURE.md` for version 1.2.0 setup, parts payments, verified email recovery, finance reports, tests and remaining work.

## Version 1.3 extension
See [INTEGRATE-V1.3.md](INTEGRATE-V1.3.md) for the new operations modules, migration instructions, configuration, and known limits.
