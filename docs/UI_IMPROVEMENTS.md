# UI improvement verification

The existing Node/browser application was improved locally. Original authentication, status values, transition rules, price snapshots, exact backend totals, transaction boundaries, customer authorization, and signed service interfaces were retained. The only domain-query addition is read-only item-count and existing service facts in the order-list response. No database migration or new package is required.

## What changed

- Consistent dark green, cream, and white styling; larger headings/content; shared SVG icons; visible focus outlines; responsive cards, panels, and touch controls. The login’s decorative chart is replaced with a numbered order/reservation/payment/delivery illustration.
- Login has show/hide password, inline validation, retained email after failed authentication, and one shared processing lock for manual/demo sign-in. Demo shortcuts are grouped in a compact disclosure with explicit explanation and render only when the server’s explicit demo configuration is enabled.
- Authenticated customers see **My orders**, their own values, customer-facing empty states, and session-assigned identity. Staff see **Sales & orders**, customer selection, attention notices, and authorized operations.
- Order list has status shortcuts/counts, labeled search/date/status filters, reset, active-filter chips, result counts, explicit View order links, item quantity counts, updated dates, contextual next steps, and mobile order cards.
- Ten records per page within the existing API’s maximum 500 returned records. Summary cards use the matching records; shortcut counts use the most recent permitted records before filters. These scopes are stated in the UI. Submitted product value explicitly excludes drafts/cancellations and is not described as revenue. Created-date filters retain the backend’s UTC convention; displayed times use Philippine time.
- Create/edit follows **Select items → Recipient details → Review order**, retaining values when moving back. A desktop summary shows seller, products, quantities, line totals, and product total; it moves below the form on mobile. Recipient validation is inline. Review saves the draft and rechecks prices on the backend before explicit acceptance.
- Order details prioritize the current status, next step, verified progress, purchase, recipient, separate service facts, and full history. Draft/cancellation paths use explicit exception panels instead of a misleading completed progress bar. Raw reconciliation details remain in staff views; customers get a readable explanation.
- Cancellation requires a reason and shows checks/release progress. Customers cannot verify payment, force completion, or enter staff operations. Timeouts remain unresolved.

## Executed checks

- `node --test --test-concurrency=1 --test-reporter=dot tests/sales.test.mjs tests/ui.test.mjs`: **38 tests passed** (30 existing backend/HTTP regressions, eight focused progress/presentation tests).
- `node tests/browser-qa.mjs`: passed in locally installed Microsoft Edge. The browser exercises real controls and uses an isolated in-memory demo database. Populated fixtures are created through Sales workflows and explicit service simulators, leaving persistent user data unchanged.
- Browser coverage: empty/invalid/failed login, password visibility, email retention, shared login loading lock; customer/staff empty and populated lists; filters/reset/no results/pagination; duplicate item selection and invalid quantity feedback; three-stage create/edit and retained recipient values; explicit current-price acceptance and reacceptance after a backend price change; stock/payment/delivery simulation to completion; verified milestones and full history; cancellation reason validation and pending-cancellation display; customer identity and operations restrictions; keyboard focus, reduced-motion preference, and desktop/mobile page overflow.
- Browser also verifies demo shortcuts/credentials are absent when the client receives non-demo configuration. This is a presentation-gating check, not proof of a live service deployment.
- Desktop screenshots use 1440×1000; mobile uses 390×844; login additionally checked at 320px. No uncaught browser JavaScript errors. QA browser/server close afterward.

## Screenshot files

Saved in `data/screenshots/` (ignored local QA artifacts):

- `ui-login-desktop.png`, `ui-login-mobile.png`
- `ui-staff-empty.png`, `ui-customer-empty.png`
- `ui-staff-orders-desktop.png`, `ui-staff-orders-mobile.png`
- `ui-customer-orders-desktop.png`, `ui-customer-orders-mobile.png`
- `ui-select-items-desktop.png`
- `ui-recipient-desktop.png`, `ui-recipient-mobile.png`, `ui-customer-recipient-mobile.png`
- `ui-review-desktop.png`, `ui-changed-price-review.png`
- `ui-pending-stock-desktop.png`
- `ui-detail-desktop.png`, `ui-detail-mobile.png`
- `ui-cancellation-pending-desktop.png`, `ui-cancellation-pending-mobile.png`
- `ui-no-results-desktop.png`

## Remaining limits

MySQL and live Catalogue/Inventory/Billing/Delivery integration remain unverified because server credentials, authoritative endpoints, physical-delivery metadata, and approved contracts have not been supplied. Demo service results remain explicitly simulated. This change does not deploy the site, add production fixtures, or change integration ownership.

Pagination covers the existing capped result set; full server-side pagination for more than 500 returned matches is not implemented. Date filters use UTC as in the original backend. Registration and password recovery are not introduced because the existing authentication setup has no approved recovery/registration flow. Browser automation checks keyboard focus and layout but does not constitute a screen-reader audit.

Restart an existing local Node process to load the new static-module route, then run `npm.cmd run demo` and open `http://127.0.0.1:3100`.
