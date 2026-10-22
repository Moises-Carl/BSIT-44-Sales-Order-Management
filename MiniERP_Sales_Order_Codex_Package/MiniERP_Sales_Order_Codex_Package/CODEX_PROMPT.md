# Codex task: Implement our Mini-ERP Sales/Order Management module

Build our assigned Sales/Order Management module. Inspect this package and the actual project, then implement and verify the work. Do not stop after producing a plan. This package contains source reference documents and a proposed schema, not a runnable application or proof of live integrations.

## 1. Context and reading order

This is a Universidad de Manila System Integration and Architecture / Platform Technology Mini-ERP project. Five groups own: (1) Catalogue, (2) Sales/Order—our group, (3) Inventory, (4) Billing/Payment, and (5) Delivery/Shipment.

Read `README_START_HERE.md`, the combined integration PDF, `System1_and_2.sql`, the Sales DOCX, and the other groups' references. Text extracts are included for convenience; consult original PDFs/DOCX/images for diagrams and tables. `INTEGRATION_REVIEW.md` is an analysis of differences, not an approved class specification. `SOURCE_MANIFEST.json` identifies source files, origins, and checksums.

Follow applicable AGENTS.md instructions. Inspect the project framework, database, authentication, backend, Catalogue functionality, Sales code, migrations, tests, and run instructions before editing. Preserve unrelated work and reuse existing conventions. Do not overwrite a populated database or destructively import the supplied CREATE TABLE script.

The combined SQL targets MySQL 8.0.16+ or compatible MariaDB, while older Sales/Inventory documents still discuss Firebase or Supabase. Determine what the project actually uses. Follow a working existing stack. If the project is empty and there is no contrary evidence, choose a straightforward web application compatible with the supplied MySQL schema and document the choice. Do not pretend the database platform is class-approved merely because this package contains SQL.

If an essential external decision cannot be inferred, ask one focused question and continue work that does not depend on its answer. Do not make live cloud/database changes or deploy simply because implementation is requested. Local reversible implementation and verification should proceed.

## 2. Ownership boundaries

- Catalogue owns categories, products, sellers, offers, current prices, and catalogue statuses.
- Sales owns orders, ordered items, accepted names/prices, product totals, overall order status/history, and order coordination. Customer contact records belong here provisionally unless a shared account/customer system already exists.
- Inventory owns availability, stock balances, reservations, expiry, release, deduction, and movement history.
- Billing owns invoices, payment attempts, verified payment results, transaction references, and refunds.
- Delivery owns shipments, courier assignment, tracking, shipment events, and proof of delivery.

Sales must not directly edit another module's operational records to simulate integration. Use existing interfaces or explicit adapters. Reuse shared authentication rather than inventing a separate password database.

## 3. Existing combined SQL

Verify these details against the file:

Catalogue tables: `category`, `product`, `seller`, `seller_offer`.
Sales tables: `customer`, `sales_order`, `order_item`, `order_status_history`.

`seller_offer`: offer_id, seller_id, product_id, selling_price, offer_status.

`sales_order`: order_id, order_number, customer_id, seller_id, submission_reference, order_date, order_status, order_total, recipient_name, recipient_contact, requested_delivery_address, cancellation_reason, created_at, updated_at.

`order_item`: order_item_id, order_id, seller_id, offer_id, product_name_at_order, quantity, unit_price_at_order, line_total.

`order_status_history`: history_id, order_id, previous_status, new_status, changed_at, change_source, actor_reference, reason, source_event_reference.

Existing constraints support unique order numbers, unique non-null submission/event references, one occurrence of an offer per order, positive quantities, nonnegative money, and one seller per order through composite foreign keys. line_total is generated. `v_orderable_offer` exposes offers only when offer, product, and seller are all active. This view does not establish available stock.

Original Catalogue uses a composite seller/product key. Combined SQL adds offer_id while retaining uniqueness of (seller_id, product_id). Preserve or explicitly map the real system's identifiers; do not invent IDs from display names.

The schema alone does not enforce legal status transitions, immutable submitted details, complete order contents, total consistency, event verification, or correct coordination. Implement those rules in the backend.

## 4. Initial scope

Unless actual agreed implementation establishes otherwise, use these provisional defaults:

- PHP currency and exact monetary arithmetic (decimal or integer centavos).
- One seller per order, positive whole-number quantities, all-or-nothing reservation.
- Full verified payment and valid confirmed stock before fulfillment.
- One shipment per order; no partial fulfillment.
- No COD, paid cancellation, return, or refund workflow in the initial Sales demonstration.
- order_total is the product amount. Do not silently add shipping, taxes, or discounts. Where supported, make charge components and final invoice payable amount explicit.

Record these as provisional choices, not class-wide approvals. Unsupported workflows must not appear functional in the UI.

## 5. Required interface

Build a professional responsive interface using the project's existing design system where present:

1. Order list: search by order number/customer, status/date filters, appropriate pagination, useful loading/empty/error states.
2. Create/edit draft: select or create customer according to ownership model, browse active offers, display seller/product/price/quantity/line total, add/remove items, increase quantity for repeated offer selection, prevent mixed sellers, enter recipient/contact/address, show product total.
3. Review/submit: complete order review, fresh backend validation, clear inactive-item errors, explicit acceptance of changed prices, duplicate-submit protection.
4. Order detail: immutable submitted purchase details, overall order status, separate reservation/payment/shipment information, timeline/history, valid contextual actions, understandable unresolved/error states.
5. Cancellation: reason and coordination progress; cancellation completes only after required verification and release.

Keep implementation terminology out of customer-facing flows. Never offer ordinary customers buttons that mark payments verified, fabricate stock, or force completed orders.

## 6. Submission and lifecycle

Drafts are editable. Submission requires an authorized valid customer, at least one item, positive integer quantities, complete nonblank recipient details, a single seller, and active offer/product/seller.

Do not trust browser prices, totals, customer ownership, or status values. On the backend revalidate current Catalogue data and compare it to prices the user reviewed. If prices changed, show the revised total and require explicit acceptance. Revalidate again when accepting; stale acceptance must not authorize another unseen change.

Atomically save accepted price/name snapshots, product total, submission time, pending_stock status, and status history. Protect concurrent submission. Make local database work atomic, but do not hold a transaction open across remote service calls. Use reliable retryable coordination appropriate to the existing architecture.

Submitted details are locked. Later Catalogue price/name/status changes must not rewrite historical orders. The combined design proposes that deactivation blocks new purchases without silently cancelling existing ones; document this as provisional if class agreement is unavailable.

Workflow:
- Submit -> pending_stock; request Inventory reservation.
- All items reserved -> awaiting_payment; request Billing.
- Verified full payment AND valid confirmed reservation -> confirmed.
- Delivery accepts authorized fulfillment -> fulfilling.
- Verified delivery AND required verified payment condition -> completed.

Order statuses: draft, pending_stock, awaiting_payment, confirmed, fulfilling, completed, cancellation_pending, cancelled. Validate transitions on the backend; do not expose a free-form status editor. Payment and shipment statuses remain independent authoritative facts from their owners. Write history with every accepted transition.

For submitted cancellation, enter cancellation_pending, block fulfillment, check Billing, and coordinate stock release. Mark cancelled only after confirming payment has not succeeded and no active reservation remains. A payment/cancellation race or payment after expiry requires reconciliation, never silent cancellation or unverified fulfillment.

## 7. Integration contracts

Catalogue: read offer_id/product_id/seller_id/name/current selling_price and active statuses. Catalogue is read-only from Sales. Validate at add-to-draft and submission.

Inventory: send order_id, order_item_id, offer_id, quantities, and unique request reference. Receive success/rejection/pending result, reservation IDs, expiry, short-item details, confirmation and release results. Availability is not reservation. A timeout is unresolved: query/retry with the same reference, not a new reservation. Notify Inventory of verified payment to confirm held stock.

Billing: send order/customer references, accepted items/prices/product total and agreed charges. Receive invoice reference, verified payment result/amount, transaction reference and event ID. Validate order, amount, source, and current state before progressing.

Delivery: send authorized order/item/product references, recipient/contact/address and agreed fulfillment data. Receive shipment acceptance/reference/tracking/events/proof-backed delivery results. Ensure shipments and shipment items link to the correct Sales records.

Authenticate integration events using the project's established mechanism. Reject invalid results, recognize repeated events, and handle late/out-of-order events safely. Scope idempotency references to the producer/operation as necessary. Reusing a reference with different payload must not silently accept an unrelated result. Do not assume a unique column alone implements reliable idempotency.

## 8. Known differences requiring alignment

Inspect `INTEGRATION_REVIEW.md` and originals. Resolve what available code/contracts establish; otherwise document a provisional local policy without changing another group's system:

1. MySQL versus older Firebase/Supabase proposals.
2. offer_id versus seller/product pair; current_price versus selling_price; status versus seller_status.
3. Sales permits payment retry while reservation remains valid; Inventory describes releasing stock on payment failure. Both implementations must agree.
4. Inventory deducts stock at dispatch; Delivery describes pickup. Pick one agreed event and prevent double deduction.
5. Sales proposes prepayment; Billing/Delivery mention COD. Exclude COD unless supported by an agreed complete workflow.
6. Product subtotal versus shipping charges/final amount due.
7. Delivery's integration text requires order/item linkage not explicit in its listed shipment schema.
8. Shared customer identity versus separate Sales/Delivery customer records.
9. Original Catalogue allows active products without current offers; combined prose overstates mandatory offer participation. Do not reject Catalogue records merely for lacking offers; purchases require an actual active orderable offer.

Inventory proposes all-or-nothing reservation and 30-minute unpaid expiry, but the duration is not proven approved. Delivery also requests product weight/dimensions and pickup data not present in the combined Catalogue tables. Do not fabricate missing physical metadata or silently calculate shipping from invented data.

## 9. Missing modules

If live modules are absent, implement stable integration interfaces and isolated local development adapters/simulators behind explicit configuration. Label all simulated results. Keep simulator actions separate from customer controls. Production must not silently fall back to fake stock/payment/delivery. Report simulator verification separately from live integration verification. Do not represent a development simulator as another group's completed system.

## 10. Security and reliability

Use existing auth with customer ownership and staff/service roles. Enforce authorization on reads/writes/backend actions. Protect unique order-number allocation, concurrent submission/state changes, exact totals, immutable snapshots, atomic history, retention of submitted orders/items/history, and safe repeated requests. Handle conflicting events without corrupting the order. Do not bypass required verification for the demo.

## 11. Verification

Run focused tests for valid draft/submission; repeated offers; mixed sellers; missing details/empty items; inactive product/seller/offer; price-change acceptance; price snapshots; exact totals; repeated/concurrent submissions; stock rejection/timeouts; verified payment plus valid reservation; failed-payment policy; late payment after expiry; duplicate/out-of-order events; fulfillment/completion; cancellation/payment races; and access restrictions.

Run the application and perform a browser walkthrough if available. Keep evidence truthful, and distinguish simulated and real dependencies. Test meaningful behavior rather than merely mirroring implementation. Do not claim tests passed unless executed.

## 12. Deliverables and completion

Deliver a working Sales module in the project, safe additive migrations if needed, integration adapters/contracts, clearly isolated fixtures/simulator where needed, focused tests, exact setup/run commands, an integration guide with payloads/IDs/statuses/ownership/unresolved agreements, and a demo walkthrough.

Final report: implemented behavior, changed files, run instructions, test results, real versus simulated integrations, and exact remaining blockers. Continue through implementation and verification; do not stop after recommendations. Never claim all five modules work together unless actually verified.
