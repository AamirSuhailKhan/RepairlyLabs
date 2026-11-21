# RepairlyLabs V1.4 — Personal Spare-Part Enquiry & Quotation Desk

## What this adds

Customers can ask for a specific phone part even when it is NOT in the inventory catalog. This is intentionally a **request / staff quote / customer decision** flow, not an unverified checkout. The existing cart, repair bookings and QR payment modules remain unchanged.

### Customer-facing page

`/part-request/`

Form fields: mobile brand, model (searchable suggestions), model variant, colour, needed part category, detailed description, quantity (1–20), preferred part grade, urgency, optional private PNG/JPEG photo (up to 350 KB), name, Indian mobile phone, email, WhatsApp contact consent, area, PIN code, full address, collection/delivery preference and notes, plus privacy consent. Full address is mandatory for delivery requests.

Submissions are stored immediately with server submission time. Every request gets a new RLI reference with cryptographically random 16-hex suffix and a permanent reservation in the existing reference registry. Retried requests with the same secure idempotency key are replayed rather than creating new records. A second identical request within two minutes is rejected.

Customers receive a 43-character private access code and can revisit `/part-request/#RLI-...:<private_code>` to view the quote without exposing contact details. **The code should be kept private.** A customer can accept or decline an unexpired quote; neither action is a payment or an order.

### Owner and manager inbox

`/part-request/?admin=1`

Owner/manager must already be signed in at `/admin`. Technician and accountant roles cannot view the inbox. Inbox auto-refreshes every 12 seconds while visible, shows new requests/unread count, includes an >10-minute unanswered indicator, searches by name / phone / brand / model / category / locality / reference, and displays request details and submission time in IST. Teams can select `reviewing`, `quoted`, `unavailable`, or `closed` with stock availability, verified unit price, delivery charge, availability timing, price expiry, and written notes. The server computes quote totals as unit price × quantity + delivery fee. Accepted or closed requests are locked against staff price edits. Logged actions are saved to a separate event history.

Staff have one-click Call, optional consented WhatsApp reply, optional email reply, and Maps address lookup shortcuts. Sending an SMS/email/WhatsApp message **is not automatic** simply because an inquiry or quote was stored.

### Notification / response speed

The database saves the request immediately. The team inbox polls every 12 seconds in an open browser tab. If `NOTIFY_WEBHOOK_URL` is configured, the existing application sends signed `parts.inquiry_requested`, `parts.inquiry_quoted`, and other event webhooks for automation tools. Configure a real webhook and staff coverage if you want timely external alerts. **A response within minutes is a staffing goal, not an SLA guaranteed by this code.** `webhook` delivery can fail; use the dashboard as source of truth.

### Quotation vs payment

This module does **not** collect money, verify QR transfers, or deduct inventory. A quote is only valid after the team checks actual price/stock. Accepting a quote notifies staff to confirm the order. After acceptance, the team can create/confirm a genuine spare-parts order through the existing order workflow with its existing private payment portal. It does not automatically convert an unlisted part into an inventory SKU. Do not state otherwise to customers.

## Installation into an existing RepairlyLabs V1.3.1 project

1. Make a consistent backup of the real project, `.env`, and **persistent `data/` SQLite database**. Do not overwrite customer data.
2. The *full website archive* includes all source files. If using the *integration patch*, compare and merge the changed `src/server.mjs` and `public/app.js` if your version has additional custom modifications. Add the new files at the paths shown below.
3. Start the application using your normal `npm start`, Windows launcher, or production Node host. The new tables are created idempotently at startup; the database is not cleared.
4. Open `/part-request/` and submit a test enquiry with a new unique phone. Sign into `/admin` as owner or manager and open `/part-request/?admin=1` to respond. Verify the private quote link.
5. Optional: configure `NOTIFY_WEBHOOK_URL` (HTTPS) and `NOTIFY_WEBHOOK_SECRET` in your private `.env` for immediate external automation (e.g. push to staff). This project does not itself send customer WhatsApp messages automatically.

### New / changed files

- `src/part-inquiries.mjs` — SQLite schema, APIs, auth, idempotency, notes, private photo, quote and status lifecycle.
- `src/server.mjs` — API registration, upload cap for photo, static route mapping and noindex header for admin view.
- `public/part-request/index.html`, `app.js`, `style.css` — polished responsive customer and staff experience.
- `public/app.js` — links in storefront/shop/products/footer/admin.
- `tests/part-inquiries.test.mjs` — test scenarios for ID allocation, retry safety, customer privacy, manager/technician permissions, quotes, decline, acceptance and image access.

### API summary

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/part-inquiries` | Public, rate-limited | Submit enquiry |
| POST | `/api/part-inquiries/access` | Reference + private access code | View quote |
| POST | `/api/part-inquiries/decision` | Reference + private access code | Accept/decline |
| GET | `/api/part-inquiries/admin/overview` | Owner/manager session | List/search inbox |
| GET | `/api/part-inquiries/admin/:reference` | Owner/manager session | Full details and optional private photo |
| PATCH | `/api/part-inquiries/admin/:reference` | Owner/manager session + CSRF | Set price, availability and reply |

### Production prerequisites and limitations

- Use **persistent** Node hosting with a backed-up SQLite volume. The included Vercel serverless API deliberately rejects unsafe ephemeral database requests; do not deploy as a Vercel serverless SQLite API.
- Configure real business details and validated product/repair policies. No example stock or quoted price should be represented as verified stock.
- Configure your own staff notification automation; use staffed hours and realistic quote response targets.
- The public private-access code is a bearer credential; keep it secret and do not send it to strangers.
- Quotation is not a sale; no inventory reservation or payment occurs at the enquiry stage.
- Desktop/mobile visual browser check could not complete in the current environment due to Chromium `ERR_BLOCKED_BY_ADMINISTRATOR`; do final visual testing on your actual computer.

## Tested

`npm test`: 19/19 tests passed. `npm run audit`: 23/23 checks passed. `node --check` passed on changed JS. These are automated tests, not proof of live notification delivery or real-world business fulfillment.
