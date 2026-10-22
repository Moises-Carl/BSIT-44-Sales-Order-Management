# Customer accounts, saved recipients and drafts

Implemented in the existing Node/HTTP and plain browser JS application. No new frontend framework or account provider is required. Existing scrypt password hashes, database sessions, HttpOnly/SameSite cookies, CSRF checks and ownership authorization remain in use. Registration creates customer accounts only; initial staff provisioning remains a separate administrator operation.

## Use the app

1. At sign-in choose **Create a customer account**, enter your name, email and matching password (12–200 characters). Registration signs you in and opens **My profile**.
2. Save your full name, contact number, default recipient name and default delivery address in **My profile**. Blank defaults are allowed and shown as missing on the recipient step.
3. **Create order** loads saved defaults once, before rendering. Change them for this order, use **Deliver to someone else** to clear recipient fields, or restore them with **Use my saved details**. Only **Save as my default details** updates your saved contact/recipient/address from the order form.
4. Choose **Save draft** beside Continue. Incomplete recipient information is allowed. Saving stays on the current step and repeated saves update the same order. Find it in **My orders → Drafts → View order → Continue draft**.
5. Leaving a changed order offers Save draft, Discard changes, or Keep editing. A clean order does not prompt. Browser reload/tab close uses the browser's native unsaved-changes warning; browsers do not permit a custom three-button dialog there.
6. Continue to review checks completeness and current Catalogue data; explicitly accept names, quantities, prices and total before Submit order. Submitted orders retain their recipient and price snapshots after later profile edits.

## Additive migration

SQLite demo creates the new table automatically on startup, preserving existing accounts and orders. For a previously initialized MySQL deployment, configure MYSQL_URL for the intended existing Sales database, review src/migrate-profile.mjs and run:

~~~powershell
npm.cmd run db:migrate
~~~

This runs only CREATE TABLE IF NOT EXISTS sales_customer_profile (customer_id INTEGER PRIMARY KEY, default_recipient_name VARCHAR(150) NOT NULL, default_delivery_address TEXT NOT NULL). Full name and contact reuse customer.customer_name and customer.contact_number. Existing customers without an extension row retain their existing name as the initial recipient suggestion; no existing order is rewritten. Fresh db:init includes this table. Do not rerun db:init on an existing database. The migration is rerunnable and does not drop, truncate, alter, seed or overwrite existing tables/rows. DDL permissions are needed for migration; the runtime account need not retain them.

## Verification

- npm.cmd test: 61 passing tests, including four focused account/profile/draft suites and the 57 existing workflow/HTTP/UI tests.
- node tests/browser-qa.mjs: existing Edge walkthrough passes with an explicit discard choice when leaving a changed new order.
- node tests/browser-accounts.mjs: real Edge UI registration, invalid registration, login/logout, customer profile navigation, partial/full defaults, explicit default save, order-only edits, immutable submitted recipients, incomplete draft persistence/resume, repeated save loading lock, injected HTTP save failure preserving inputs, all three leave choices, clean navigation, Back/Continue preservation and final submission pass.
- File-backed SQLite is closed/reopened in a regression test to verify account/profile/draft persistence across application database restarts.
- Draft assertions verify no reservation, payment or delivery outbox requests before submission. Existing tests still cover final prices/availability/single-seller validation, exact totals, immutable snapshots, duplicate submission, service signatures and cancellation races.
- Screenshots in ignored data/screenshots: ui-registration-{desktop,mobile}.png, ui-profile-{desktop,mobile}.png, ui-saved-recipient-{desktop,mobile}.png (mobile recipient at 320px), ui-account-review-{desktop,mobile}.png and ui-unsaved-changes.png. Desktop and 320/390px layouts checked for overflow; recipient screenshots visually inspected.

## Deployment limits

Authentication and saved account/order data are real persistent local application features, including in explicit demo mode. Demo Catalogue and external Inventory/Billing/Delivery responses remain simulated and labeled. No shared account service is configured. Live MySQL migration and partner-service end-to-end testing have not been run because deployment credentials and partner endpoints/contracts are not configured in this checkout. Those remain integration/deployment work; simulator results are not proof of live service integration.
