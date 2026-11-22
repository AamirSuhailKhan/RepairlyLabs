# RepairlyLabs — India-wide Parts Enquiry Redesign

Version: 2026-11-22 (based on RepairlyLabs V1.4 Navbar-Fixed Source)

## Product change

**Public mobile parts are enquiry-only.** Instead of displaying sample part photos, prices, cards, stock estimates or a direct cart, the public website asks visitors for the exact phone model, the part they need and their location. Staff confirm suitability, grade, actual availability, shipping feasibility and a **personal quotation**. Customers can privately view and accept or decline that quote. No charge is made when someone submits an enquiry.

The existing repair booking workflow is preserved. **India-wide applies to parts enquiries, not a guarantee of nationwide physical repair/pickup, stock or shipping.** Staff must confirm delivery for each PIN code.

## Public pages

- `/` — homepage redesigned with an India-wide parts request feature panel, no sample product cards or prices.
- `/parts` — a premium informational parts-request landing page with common component shortcuts, no catalog.
- `/part-request/` — full request form including brand/model/variant, component/condition, quantity, grade, optional photo, mobile/WhatsApp, email, locality, **city**, **state/UT**, PIN code, address and preferred delivery method.
- `/part-request/#status-check` — private quote lookup after staff response.
- `/part-request/?admin=1` — existing staff parts enquiry inbox; now shows city and state/UT in customer detail and search.

The header cart button is removed. Direct public catalog price APIs and public direct-checkout APIs now return HTTP 410 by default. The staff product/inventory management API and historical orders/payments remain untouched. Set `PUBLIC_LEGACY_CATALOG=1` *only* if you intentionally need to re-enable the old public catalog endpoints; **it does not restore the removed public storefront UI**.

## Files modified

- `public/app.js`: public nav, homepage, `/parts` landing, footer and copy; no public cart/catalog data request.
- `public/india.css`: accessible, responsive nationwide parts UI styling.
- `public/index.html`: updated nationwide metadata, new stylesheet, cache version.
- `public/part-request/app.js`: improved request hero and new city/state inputs; staff screens display destination.
- `public/part-request/india.css`: premium request form styling.
- `public/part-request/index.html`: nationwide messaging and stylesheet.
- `src/part-inquiries.mjs`: additive, migration-safe `city` and `region` SQLite columns; validates full destination on delivery requests.
- `src/server.mjs`: retires public product and cart endpoints by default (HTTP 410); customer request API stays available.
- `src/seo.mjs`: removes product listings from sitemap; legacy part pages no longer expose price and have `noindex`.
- `public/manifest.webmanifest`, `package.json`: descriptions.
- `tests/backup-seo.test.mjs`, `tests/part-inquiries.test.mjs`: regression test updates.

## Integration into an existing site

1. **Back up your current source and persistent SQLite database first.** Use an SQLite-consistent backup, not an uncoordinated copy during writes.
2. Extract the changes-only patch into the **root of your existing RepairlyLabs project**, merging the `public/`, `src/`, and `tests/` directories. Review any newer modifications first; do not blindly overwrite local changes.
3. Preserve your existing `.env`, `data/` folder, admin accounts, payment gateway configuration and actual customer records.
4. Restart your actual persistent Node server. The two new columns are added automatically on server startup and existing enquiry rows remain in the database.
5. Clear old frontend cache / refresh the browser, then check `/`, `/parts`, `/part-request/` and `/part-request/?admin=1` in Chrome on desktop and mobile.
6. Test a synthetic India-wide delivery enquiry and staff quotation in a staging database before accepting real requests.
7. Configure real phone, email, address, working hours and notification credentials if you want customer messages. **We do not guarantee a reply within minutes**: staff must be available and notifications configured.

## Actual test evidence (this environment)

- `npm test`: **19 passed, 0 failed**.
- `npm run audit`: **23 passed, 0 failed**.
- HTTP smoke: home, parts, request form and CSS files returned **200**. Public catalog endpoints and direct cart checkout returned **410** by design.
- Isolated Chromium rendering fixtures: homepage, parts landing and enquiry form at **1440px and 390px** had no horizontal overflow and no rendered sample price or product card. Fixtures use stubbed data and **are not proof of live end-to-end browser operation**.
- Real Chromium navigation to localhost was blocked by `ERR_BLOCKED_BY_ADMINISTRATOR`, so real-browser forms, navigation, staff flows and payment interactions **were not visually E2E verified here**.
- No real messaging/UPI payment, shipping, notification or live deployment was tested.

## Security / deployment

- The new city and state/UT fields are stored with the customer enquiry and shown only in the authenticated staff detail view. Private links remain necessary for customer quotation access.
- The project still has a Node + SQLite architecture that **requires persistent server storage and tested backups**. Do not deploy unchanged to ephemeral Vercel serverless infrastructure for customer records.
- Existing gateway, QR and legacy order infrastructure remains for historical access, but the **public purchase entry point is now the team-reviewed enquiry**.

## Previews

The screenshot files in `docs/india-*.png` are **isolated visual rendering fixtures**, not screenshots from a live browser session or claims of live availability. Check the actual site locally before release.
