# BSIT-44 Sales-Order Management

A local university Sales module with a responsive browser interface, authenticated staff/customer accounts, locked submitted purchases, exact PHP product totals, status history, and durable integration requests.

## Run the demonstration (no installation or MySQL required)

Requires Node.js 22.14 or newer. In a terminal opened in this folder:

```powershell
npm.cmd run demo
```

Open **http://127.0.0.1:3100**. Stop with Ctrl+C.

| Account | Email | Password |
| --- | --- | --- |
| Sales staff | admin@example.test | CampusDemo2026! |
| Customer Alex | alex@example.test | CampusDemo2026! |
| Customer Jamie | jamie@example.test | CampusDemo2026! |

The page also provides demo sign-in buttons. Demo data persists in `data/demo.sqlite`; tests use independent, temporary in-memory databases. Demo mode binds to loopback and refuses `NODE_ENV=production`. Node may print an experimental SQLite warning on version 22; this is expected.

**Every demo Catalogue record, reservation, payment, and shipment is simulated.** Simulator controls are restricted to the staff **Processing outcomes** page. Customer accounts can only access their own orders. No real integrations have been verified.

## Local demo product photos

All six demonstration products have locally bundled sample photos in selection, selected items, review and order details. Photos are illustrative; the demo works without external image services. Catalogue image URLs/references can take priority through the shared thumbnail adapter. See [photo sources, licenses and integration notes](docs/PRODUCT_PHOTOS.md).

## Customer accounts and saved drafts

Choose **Create a customer account** at sign-in, then use **My profile** to save contact and default recipient/address details. New orders prefill those details; reopened drafts retain their own saved values. Recipient edits apply only to the current order unless you choose **Save as my default details**. Use **Save draft** beside Continue, then resume through **My orders → Drafts → View order → Continue draft**. Leaving an unsaved order offers Save draft, Discard changes, and Keep editing.

For an existing MySQL installation, configure MYSQL_URL and run **npm.cmd run db:migrate** and **npm.cmd run db:migrate-workflow**, and **npm.cmd run db:migrate-payment** before starting the updated server. These commands add the profile, notification and payment-method tables; SQLite demo upgrades automatically without resetting existing data. See [Accounts and drafts](docs/ACCOUNTS_AND_DRAFTS.md) for migration details, verification and deployment limits.

## Demo walkthrough

1. Sign in as a customer. Save profile/default recipient details, create an order, and choose products.
2. Use **Save draft** beside Continue to return to My orders. Incomplete recipient details are allowed. Open the saved draft and choose Continue draft to resume.
3. Complete recipient details and choose GCash, Bank transfer or Cash on delivery. Review and accept the payment method/current prices, then submit. Staff can create orders on a customer's behalf and save drafts back to Sales & orders.
4. As Sales team, open **Processing outcomes**, choose an order, and review its current stage. Choose **Successful**, **Unsuccessful**, or **Cancel order** where available, then **Apply outcome**. Unsuccessful and cancellation require a reason shown to the customer.
5. GCash/bank transfer use stock reservation → invoice → payment verification → reservation confirmation → shipment acceptance → delivery confirmation. COD uses stock reservation → COD arrangement → reservation confirmation → shipment acceptance → delivery confirmation → Billing collection verification. Each demo result comes from the existing simulator adapter; COD ships unpaid and completes only after collection is verified.
6. Use separate orders for stock rejection, failed payment, delivery failure and cancellation. Failed payment has no automatic retry; stock release is coordinated and cancellation remains a checked workflow. Cancellation payment checks can report a paid conflict, which keeps cancellation unresolved.
7. Customers receive persistent **Notifications** for rejection, failure and cancellation, with order links and read state. The same outcome appears in My orders and order details. Terminal orders offer no processing action.
8. Timeouts remain unresolved. Verified history is preserved. Diagnostic queues/payloads remain in backend storage and are absent from the app UI. Live mode checks authoritative services and never manufactures a successful or failed external result from the dropdown.

See [workflow fixes and verification](docs/ui-review/2026-10-22/WORKFLOW_FIXES.md) and its screenshot index.

## Tests

```powershell
npm.cmd test
# Focused example:
node --test --test-name-pattern="cancellation" tests/sales.test.mjs
```

Tests cover centavos, draft edits, merged quantities, mixed sellers, invalid orders, inactive Catalogue data, changed-price acceptance, snapshot preservation, duplicate/concurrent submission, event deduplication, stock timeouts/rejections, payment amount/source checks, expiry, cancellation races, status history, customer isolation, authentication, CSRF, and HTTP assets.

## MySQL setup (separate from demo)

Use a dedicated **empty** database, MySQL 8.0.16+ or compatible MariaDB with enforced CHECK constraints. A database administrator must create the database and a restricted application account. Never run initialization on a populated/shared database.

```powershell
npm.cmd ci --ignore-scripts
$env:MYSQL_URL = 'mysql://mini_erp_user:YOUR_PASSWORD@127.0.0.1:3306/mini_erp'
$env:ADMIN_EMAIL = 'your-team@example.edu'
$env:ADMIN_PASSWORD = 'YOUR_UNIQUE_LONG_PASSWORD'
npm.cmd run db:init
npm.cmd start
```

Initialization checks the database is empty **before DDL**. It uses the packaged original Catalogue/Sales schema without dropping tables or changing its constraints, creates additive Sales integration/authentication tables, and creates the initial staff login. It inserts **no** demo Catalogue data. MySQL DDL is not transactional: if initialization is interrupted, inspect the resulting dedicated schema before continuing; the tool will refuse to rerun over it.

Environment variables are read from the process. `.env.example` is a template; `.env` is not loaded automatically. On Node 22, `node --env-file=.env src/server.mjs` explicitly loads a local environment file. Do not commit credentials.

Catalogue must provide authoritative `category`, `product`, `seller`, `seller_offer`, and `v_orderable_offer` data in the agreed shared MySQL schema. Sales only reads Catalogue in normal operation. The separate demo database seeds fictional Catalogue data explicitly. If Catalogue has an independent database or API, implement its adapter/mapping before live use.

Staff can create customer contact records in the draft editor. Provision a corresponding customer login from a trusted terminal:

```powershell
$env:NEW_USER_EMAIL = 'customer@example.edu'
$env:NEW_USER_PASSWORD = 'A_UNIQUE_LONG_PASSWORD'
$env:NEW_USER_CUSTOMER_ID = '1'
node src/create-user.mjs
```

Use HTTPS and `NODE_ENV=production` for deployment so cookies are Secure. `PUBLIC_ORIGIN` may specify your exact HTTPS reverse-proxy origin. This project has not been deployed. Password reset, email verification, and a shared campus identity provider remain future integration work.

## Integration configuration and limits

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the proposed signed HTTP contract, request/event examples, cancellation guarantees, and unresolved agreements. Set each service URL and a separate strong shared secret before dispatching live requests. Live mode never falls back to simulation. Staff dispatch requests from **Integrations**; this release does not run an automatic background worker.

See [docs/DECISIONS.md](docs/DECISIONS.md) for provisional defaults and verification limits, and [migrations/README.md](migrations/README.md) before integrating an existing database.

## Structure

- `src/sales.mjs`: transactional business rules and state transitions.
- `src/db.mjs`: MySQL adapter and explicitly isolated SQLite demo schema/data.
- `src/integrations.mjs`: request leases, signed HTTP transport, and development simulators.
- `src/server.mjs`: HTTP API, sessions, CSRF, role checks, and static assets.
- `public/`: responsive login, order list, draft editor, review, detail, cancellation, and staff operations.
- `tests/`: executable backend and HTTP regression tests.
- `MiniERP_Sales_Order_Codex_Package/`: original reference package, retained unchanged.

For the recorded verification results, see [docs/VERIFICATION.md](docs/VERIFICATION.md). On this Windows machine you can rerun the full browser walkthrough with `node tests/browser-qa.mjs`; it uses the installed Edge browser and closes its temporary browser/server afterward.


## Share with your group

See [GitHub and groupmate setup](docs/GITHUB_SETUP.md) for uploading this repository, inviting collaborators, cloning, and running the local demo.


## Latest Sales-side integration fixes

The locally implemented fixes and current verification are recorded in [docs/BUG_FIXES.md](docs/BUG_FIXES.md). Inventory's signed lifecycle receiver, confirmed non-expiring validity, event-version rules and exact envelope are documented in [docs/INVENTORY_LIFECYCLE.md](docs/INVENTORY_LIFECYCLE.md). Real external services and MySQL still require joint integration verification.

## Staff workspace and guided demo review

See [22 October 2026 workflow follow-up](docs/ui-review/2026-10-22/WORKFLOW_FIXES.md) for role differences, guided simulation steps, confirmed fixes, browser verification and the screenshot index.

## Payment choices and COD

See [payment methods and verification](docs/ui-review/2026-10-22/PAYMENT_METHODS.md) for customer selection, checked COD processing, migration, screenshot evidence and live integration limits. Live COD is disabled unless ENABLE_COD=true is explicitly configured after service agreement.

## Closed cancellation and failure outcomes

Cancellation or a definitive unsuccessful result now closes the normal processing form and shows the order condition/reason. Demo cancellation/release checks run automatically; unresolved service checks are separate and cannot advance the purchase. See [closed-outcome verification and screenshots](docs/ui-review/2026-10-22/CLOSED_OUTCOMES.md).

### Delivery updates and Contact Sales

On an active order awaiting delivery, staff can publish a delivery delay with a reason, optional revised estimate, and next update time, or clear an existing delay. These notices never change verified stock, payment, shipment, or order status. Customers receive persistent in-app notifications.

Customers send order-linked messages under **Contact Sales** on order details. Staff use **Sales inbox** to find conversations awaiting a reply, open the order, and reply. Replies notify the customer in-app. Refresh to retrieve new messages; email/SMS and live chat are not connected. Conversations remain available for completed and cancelled orders.

Existing MySQL installations: run `npm run db:migrate-communications` before starting this version. Demo SQLite creates the additive tables automatically.

Validation: `npm test`; `node tests/browser-communications.mjs` covers desktop/mobile delays, clearance, messaging, inbox, and notifications.

### Profile payment preferences and order sorting

Customers can save GCash, bank transfer, or enabled COD as their preferred payment method in My profile. It prefills new orders; saved drafts and submitted orders retain their existing method. No bank credentials or payment account numbers are stored. Existing MySQL installations need `npm run db:migrate-preferences`; demo SQLite adds the table automatically.

Order lists offer newest, oldest, recently updated, and total ascending/descending sorting within the most recent 500 permitted orders. Sorting applies before pagination and is saved with filters. Pending payments shows unpaid active product totals, including COD collection; it excludes drafts, stock checks, ended orders, and verified payments. All panel headings use the same pale green style.

Payment can also be selected in the final review (including Review & submit on a saved draft). Changing it saves the draft, refreshes the acceptance snapshot, and requires acceptance again. COD skips advance payment and collects cash at delivery; GCash and bank transfer require Billing verification before shipment.

### Delivery attempts and order outcomes

A failed shipment acceptance or delivery attempt keeps the order active and preserves verified payment. Staff agree a new time with the customer through Contact Sales, then use **Schedule redelivery** on order details. Customers receive notices for each failed attempt and schedule. Each retry uses a distinct Delivery request; dispatch and verification are blocked before the agreed time. Repeated failures can be scheduled again. COD collection is requested only after delivery is verified; prepaid customers are not charged again.

The **Order outcome and next steps** panel separates completion/stopped processing from unresolved payment or stock issues. Completed orders notify the customer. **Order again** creates a new draft from currently orderable offers at current prices; unavailable products are omitted, and stock is checked when submitted. It never reopens the original order or reuses its payment.

Existing communications tables support this change without another migration. Refunds remain a Sales/Billing review, not a locally invented refund confirmation. Live redelivery requires Delivery to support unique attempt references and the scheduled-time payload; only the demo adapter was exercised locally.

Processing outcomes now offers order cards sorted by staff attention first, then pending work, oldest first within each group. Filters cover pending, needs attention, drafts and ended/completed orders. Cards and selector options show customer names, order numbers, pending steps and attention reasons, including unanswered customer conversations. Search rebuilds matching choices instead of relying on hidden native options. The picker covers the most recent 500 permitted orders; Show more expands the card list.

The Processing outcome dropdown also offers **Reattempt delivery** after a failed attempt. Staff record the agreed date/time and reason in place; when the retry is due, the same screen offers the verified outcome choices again. This uses the existing reschedule transaction and preserves previous payment and attempt history.

In demo mode, a scheduled redelivery keeps Successful and Attempt failed choices visible. Staff may record a completed attempt before its planned time; the original schedule remains in history. This explicit recording bypasses only the scheduled wait, never an in-flight lease or payment checks. Background dispatch still waits for the scheduled time, and live mode still requires authoritative service results.

Processing outcomes select the first valid result directly, without a Choose outcome placeholder. In demo mode an eligible failed delivery also offers Successful and Attempt failed immediately; recording a result creates a new attempt request rather than overwriting the previous terminal event. Reattempt delivery remains available for scheduling a future attempt.

### Customer draft privacy

Draft orders belong to customers. Staff APIs exclude drafts from order lists, counts, processing requests and Sales inbox, and return 404 for direct access to a draft or its actions. Staff cannot create drafts through the web API. Admin navigation and filters omit drafts and order creation. Customers retain their own draft creation, save, edit and submit flow; orders appear in the staff workspace after submission.

### Refund and return resolution (2026-10-23)

Submitted orders now include a persistent **Refund and return resolution** panel. Sales may explicitly accept cancellation while preserving original payment and shipment evidence. Cancelled and stopped orders keep their refund, return and stock obligations visible. Manual refunds progress through required, processing, failed/retry and recorded, with exact remaining-balance checks, explicit completion confirmation, evidence/reference, actor, timestamp and idempotency protection. Recording a refund does not transfer money.

Failed dispatched deliveries can stop redelivery and return to the seller. Delivery records handover/in-transit evidence; seller/Inventory confirms receipt and condition. Missing or damaged goods remain unresolved. Goods that never left the seller require reservation release rather than a physical return. A prior successful-delivery fact can only be corrected with an explicit non-receipt confirmation and Delivery evidence; the original event and correction history remain intact.

In demo mode, staff may simulate the Delivery/Inventory resolution roles, and saleable receipt writes one restoration entry per order to the demo Inventory ledger. This does not modify an external Inventory system. In live mode the roles are `staff` (Sales cancellation and manual refund administration), `billing` (manual refund evidence), `delivery` (return journey), `seller` (receipt/condition), and `inventory` (receipt/condition and external restoration evidence). Provision these roles administratively; customer registration cannot create them. Live Inventory restoration waits for responsible Inventory evidence and is labelled recorded, not automatically performed. No refund-transfer or return-service API contract is available in this repository.

Existing MySQL installations must run `npm run db:migrate-resolutions` before starting the new version. Demo SQLite creates the additive tables at startup. No existing orders, payment facts or service events are deleted.

Orders in progress is active submitted orders divided by all matching submitted orders, excluding drafts from both sides and stopped/completed fulfillment from the numerator. The list/summary now uses the full matching dataset. Section header strips share `--section-header: #2C6732` and white `#ffffff` text; the main banner retains its dark green.

Validation and screenshots: [resolution review](docs/ui-review/2026-10-23/RESOLUTION_REVIEW.md).

### Explicit issue closure

Cancelled and unsuccessful orders now have a separate issue status: Action required, In progress or Resolved. Sales admins use **Mark issue as resolved** in the resolution panel. Closure requires a note and explicit confirmation. Each outstanding cancellation, refund, return, stock or delivered-COD payment requirement must either be completed first or receive its own documented external-completion / not-applicable explanation and reference. Closure writes only issue metadata, audit history and a customer notification; it does not change order status, original payment/delivery facts, refund receipts or Inventory balances.

Resolved cases leave unresolved queues and remain searchable under Cancelled or Unsuccessful. New authoritative facts invalidate the closure snapshot and reopen issue review while preserving its original outcome and earlier closure history. This uses the existing resolution JSON and history tables, with no new schema migration. Screenshots and verification: [issue closure review](docs/ui-review/2026-10-23/ISSUE_CLOSURE_REVIEW.md).

### Sales Overview (supersedes the Orders in progress percentage card)

Sales staff and administrators now have a dedicated **Sales Overview** sidebar page, above Sales & orders. The order page retains three count cards and no percentage card. Analytics use stored Billing verification, completed order history, immutable manual refund records and item snapshots over the full permitted dataset. Filters use Philippine business dates.

The financial cards use a collections basis: **Payments collected**, **Refunds recorded**, **Net collections**, plus **Completed orders**. This includes collected money on cancelled/unsuccessful orders without mislabelling it as completed sales or subtracting its refunds from sales that excluded it. The trend uses collections; completed product rankings and recent sales use completion dates. Order-level refunds are not allocated to individual products. Coverage notes identify undated/unmatched records and external issue settlements that are not ledger entries.

The selected dates persist in the session. Refresh, reopening and idle visible-page updates fetch current records. Customers and other module roles cannot access internal analytics. No new schema migration or package dependency is required. Section strips now use **#48A04C** with dark text as specified in the latest dashboard request; the main banner remains dark green.

[Calculation basis, tests and screenshots](docs/ui-review/2026-10-23/SALES_OVERVIEW_REVIEW.md).
