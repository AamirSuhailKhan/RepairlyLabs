# RepairlyLabs — Repair-first priority and consistent services design

**Baseline:** `RepairlyLabs-Premium-Trust-Redesign-Full.zip` supplied earlier in this conversation.

## Changes

1. Primary desktop and mobile navbar button is now **Request a Repair**, taking customers to `/repairs#booking` using existing SPA routing.
2. Homepage hero's main action is **Request a Repair**; the mobile part enquiry is a secondary action.
3. The explanatory hero process now describes repair diagnosis, quotation and approval before work.
4. The repair-focused About/Approach section appears before the India-wide parts enquiry section on the homepage.
5. Final homepage CTA and footer callout prioritize repair requests, with a secondary link to the parts enquiry flow.
6. All eight repair service cards have a consistent white default background, dark navy heading, muted descriptive copy and coral icons. The original permanently dark cards (positions 1 and 6) are removed; hover and focus styles remain consistent.
7. Updates website title, description and social description to reflect repairs as the primary service.
8. Corrects the old repair-form sidebar claim that the site cannot collect payment. It now accurately describes the free enquiry and subsequent payment/quotation options.
9. Cache-busts changed `app.js` and `premium.css` resources.

## Integration steps

Prefer merging only these files into the latest local project:

- `public/app.js`
- `public/premium.css`
- `public/index.html`
- `tests/repair-first-design.test.mjs` (new regression tests)

Back up original files before merging. **Do not replace `.env`, `data/` or live SQLite files.** If your local project has newer changes than the baseline above, have your coding agent compare and merge instead of blindly overwriting `app.js`.

Restart the server, hard-refresh the browser and verify `/`, `/repairs`, `/parts`, `/repairs#booking`, `/part-request/` and admin.

## Testing completed here

- `npm test`: **23/23 passed** (19 existing tests + 4 focused design/priority regression tests)
- `npm run audit`: **23/23 passed**
- `node --check public/app.js`: **passed**
- Isolated browser-CSS layout checks using actual styles: **7 widths**, 360, 390, 768, 1024, 1380, 1440 and 1920px. All service-card default background colors match; no horizontal overflow was detected in the isolated fixture and the visible desktop navbar CTA remains inside its pill.
- Actual complete website browser navigation: **BLOCKED** by `net::ERR_BLOCKED_BY_ADMINISTRATOR` for localhost and file URLs. The CSS rendering fixture was created using `page.set_content`, not live page navigation. Do not describe this as a full E2E pass.

`REPAIR-FIRST-PREVIEWS/` contains CSS fixture screenshots for desktop/mobile to illustrate the change. Those previews are not live site screenshots; their icons are sample glyphs.

## Scope

**Not changed:** database schema, payment logic, login, staff roles, part enquiry APIs, repair workflow APIs or stored customer data.

**Service scope:** Phone repairs are offered subject to actual workshop and pickup coverage; spare-parts enquiries may come from across India. Neither nationwide repair coverage nor a fixed response time is guaranteed.
