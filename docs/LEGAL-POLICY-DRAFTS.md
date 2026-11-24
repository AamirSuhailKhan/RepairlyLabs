# Legal & Policy Drafts Review (`/` Footer -> `/privacy` & `/terms`)

**Important Disclaimer**: These texts are operational engineering drafts tailored to RepairlyLabs' actual data collection, booking, payment, and refund code paths. They are **not legal advice** and contain explicit `[OWNER TO CONFIRM]` placeholders. No fake GSTIN, company registration number, customer testimonials, ratings, or fixed warranty claims have been invented.

---

## Policy Pages Live in Storefront

- **`/privacy`**: Rendered in `public/app.js` (`privacyPage()`), canonical & sitemap indexed.
- **`/terms`**: Rendered in `public/app.js` (`termsPage()`), canonical & sitemap indexed, covers Terms & Conditions, Repair Consent, Device Data Handling, Warranty Policy, Cancellation & Refund Policy, Spare-Parts Return/Shipping Policy, and Grievance Redressal.

---

## Mandatory Owner Confirmations Before Commercial Launch

Review and supply your real business decisions for every item below (editable via `/admin` -> **Site settings** or directly inside `privacyPage()` / `termsPage()` in `public/app.js`):

1. **Legal Entity Name & Registration / GST Status** (`termsPage()` Section 1):
   - Replace `[OWNER TO CONFIRM BEFORE LAUNCH: Sole proprietorship / entity registration & GSTIN if applicable]` with either your GSTIN / Udyam registration or clarify that non-GST cash/bill-of-supply estimates are issued.
2. **Registered Workshop Address & Support Contact** (`/admin` -> **Site settings**):
   - Confirm exact visitable shop address, working hours, customer phone, WhatsApp number, and support/grievance email.
3. **Replacement Part Warranty Duration** (`termsPage()` Section 4 + `/admin` -> **Site settings -> Warranty policy**):
   - Confirm exact warranty days per component grade (e.g., OEM display vs compatible battery vs no warranty on liquid/board repairs) and physical/liquid damage exclusions.
4. **Inspection Fee & Special-Order Cancellation Deductions** (`termsPage()` Section 5):
   - Clarify whether any diagnostic inspection charge or non-refundable special-order part sourcing deposit applies if a customer cancels after approval.
5. **Spare-Parts Return Window & Shipping Terms** (`termsPage()` Section 6):
   - Specify exact days allowed for DOA/transit-damage unboxing claims and courier return rules.
6. **DPDP Grievance Contact & Retention Period** (`privacyPage()` Retention & Grievance):
   - Confirm dedicated privacy/deletion email or phone under India's Digital Personal Data Protection (DPDP) rules and how long repair invoices are retained for tax/accounting compliance.
