# Provisional decisions and verification limits

## Inspected starting state

The selected project contained reference documents, `.github/copilot-instructions.md`, and editor metadata; no application, framework, authentication implementation, migrations, database configuration, or tests. Inspected the combined MySQL SQL, README, integration review, combined/Sales/Inventory/Delivery text extracts, and Billing export. The packaged documents are design evidence, not live service evidence or class-approved contracts.

## Implementation choices

- Node.js built-in HTTP server and browser JavaScript, with MySQL through `mysql2`. This keeps setup small and preserves the original relational Catalogue/Sales table and column names.
- Explicit local demo uses Node’s SQLite module and fictional Catalogue data. It is a convenience runtime, not a change to the proposed shared MySQL database.
- PHP integer centavos for calculation; DECIMAL-compatible strings at persistence/API boundaries. UI display arithmetic is advisory; the backend calculates and validates all accepted totals.
- One seller/order, all-or-nothing reservations, verified full prepayment, one shipment/order. Product total excludes shipping, tax, and discounts. No COD, partial payment/fulfillment, paid cancellation, refunds, or returns.
- Customers remain Sales-owned pending agreement on shared identity. Staff may create contacts; trusted CLI provisions customer logins. Sessions are opaque, expiring, HttpOnly cookies and mutations require CSRF tokens.
- Price/name snapshots are refreshed on explicit review/acceptance; submitted details are immutable. Draft version checks prevent overwriting a concurrent edit.
- Original Catalogue tables and active-status view remain authoritative in MySQL. No normal Sales endpoint modifies them.
- Service results are accepted only against a matching durable request. Separate facts retain stock/payment/shipment status. Event references and request references deduplicate work.
- Transactions serialize Sales state changes. MySQL uses a database-scoped advisory lock across instances; SQLite uses immediate transactions. Remote I/O occurs outside transactions. This favors correctness over high throughput for the class project.
- 30-minute demo unpaid reservations; confirmed demo holds explicitly have no automatic expiry. These are simulator policies; real Inventory supplies actual validity. Payment failure retains unresolved stock facts; the initial UI supports cancelling and creating a new draft rather than payment retries. Inventory remains authoritative for expiry/release.
- Cancellation from draft is local. Submitted unpaid cancellation requires Billing’s authoritative unpaid closure and Inventory’s no-active-or-future-reservations guarantee. Paid results during cancellation remain unresolved for reconciliation. Confirmed/fulfilling orders are ineligible for initial cancellation.
- Dispatch remains an explicit staff operation, so the demonstration advances service by service. Real asynchronous webhooks are supported in live mode; automatic worker deployment is future operational work.

## Unresolved group contracts / blockers

1. No MySQL server or credentials supplied: MySQL connection, schema execution, driver behavior, and shared-database permissions have not been integration-tested.
2. No live Catalogue, Inventory, Billing, or Delivery service implementation/endpoints/keys supplied. Proposed HTTP contracts require each group’s agreement or an adapter to their actual interface.
3. Catalogue `offer_id` mapping and source platform (MySQL vs older Firebase/Supabase plans) need confirmation.
4. Reservation expiry and post-payment validity, failed-payment release policy, and authoritative stock deduction event (dispatch vs pickup) remain unapproved. Sales does not deduct stock.
5. Delivery requires authoritative weights, dimensions, pickup address, and shipping service information absent from the supplied schema. Nothing is invented. Delivery adapter/service must resolve these from owning systems before real acceptance; simulated acceptance does not prove real booking capability.
6. Billing/Delivery shipping charges and COD conflict with this initial product-only prepayment scope. Agree a final payable amount before enabling additional charges.
7. Shared customer/identity mapping and production account recovery remain unintegrated.
8. Existing populated database migration is not automated. A reviewed mapping and backup are needed before extending any shared deployment.
9. Manual reconciliation is intentionally visible and blocks unsafe progress; this version does not automate refunds or resolution of contradictory service results.

Actual test counts and browser verification are reported in the final handoff; no live ERP integration or MySQL verification is implied by passing SQLite tests.
