# MINI-ERP PROJECT
# SALES / ORDER MANAGEMENT SYSTEM
## Revised System Scope, Database Design, Business Rules, and Integration Requirements

Prepared by: Moises, Baello, Doroja, Ruiz, Ponce, and Areolla
Revision date: 23 October 2026
System: CampusERP Sales & Order Management
Document basis: Current repository implementation and verified local demonstration.

## Revision statement

This document replaces the earlier proposed Sales/Order Management specification for the implemented CampusERP application. It includes customer payment choices, COD processing, redelivery, customer communication, refund and return resolution, separate issue closure, and Sales Overview reporting. It distinguishes implemented local functions from external services that still require integration agreements. Statements in this document describe the application; they do not establish class-wide agreements for other teams.

## 1. Purpose and system scope

### 1.1 System overview

CampusERP Sales & Order Management records customer purchases and coordinates their progress with Product/Catalog, Inventory, Billing/Payment, and Delivery/Shipment. Sales owns the purchase record, accepted item prices, recipient snapshot, overall order progression, and Sales-side history. Verified results from the responsible systems control advancement.

The current application supports a local SQLite demonstration and a MySQL-backed deployment path. Firebase and Supabase are no longer the implementation described here. The demonstration supplies fictional Catalog data and simulated integration responses. Availability of a live database path does not mean live payment, shipment, or stock services have been validated.

### 1.2 Functional scope

- Customer registration/sign-in and role-based access.
- Customer-owned draft preparation, item selection, quantity editing, review, and submission.
- One seller per order and Philippine peso product totals.
- Active-offer validation, accepted-price snapshots, and explicit acceptance of changed prices.
- Saved customer contact, default recipient/address, and preferred payment method.
- Required per-order payment selection: GCash, bank transfer, or Cash on Delivery when enabled.
- Stock reservation, reservation expiry handling, Billing coordination, and fulfillment authorization.
- Payment-dependent order progression, delivery delays, failed attempts, and redelivery.
- Cancellation, unsuccessful outcomes, manual refund evidence, return handling, and stock-resolution evidence.
- Separate issue status and explicit administrator closure of cancelled/unsuccessful cases.
- Order-linked customer conversations, Sales inbox, and in-app notifications.
- Sales workspace search/filtering, processing actions, order history, and Sales Overview analytics.

### 1.3 Responsibility boundaries

Product/Catalog owns product/category/seller masters, seller offers, current prices, and offer availability. Sales references these identifiers and stores accepted transaction snapshots.

Inventory owns stock balances, reservation decisions and expiry, releases, deductions, and restoration movements. Sales requests actions and records their results. A Sales resolution note does not restore stock.

Billing owns invoices, payment attempts, verified payment results, transaction references, and actual refund execution. Sales can record external refund evidence through the resolution workflow; recording evidence does not transfer money.

Delivery owns shipment acceptance, tracking, delivery results, and return-journey evidence. Sales coordinates permitted redelivery and displays the history.

Sales owns orders/items/status history, customer preferences and communications within this implementation, integration request/event records, and Sales resolution audit metadata. Shared identity and customer ownership remain integration decisions.

### 1.4 Limits

Each order uses one seller, whole-number item quantities, and PHP product amounts. Partial fulfillment and split shipments are outside the current intended workflow. Shipping fees, taxes, and discounts are not added to the product total. No automated gateway collection, refund transfer, courier booking, or external Inventory restoration is claimed. Returns have order-level receipt/condition records; item-specific returned quantities and product-level refund allocation are not available.

## 2. Users and workspaces

### 2.1 Customer workspace

Customers create, save, edit, and submit their own drafts, review their own submitted orders, request eligible cancellation, read notifications, and contact Sales from an order. My profile stores defaults for new orders. Changing defaults does not rewrite existing order recipient or payment snapshots.

Payment preference is a convenience, not payment authorization. The customer reviews a required payment choice for the actual order before submission. Changing that choice during review refreshes the order review and requires renewed acceptance.

### 2.2 Sales and operational roles

The Sales administrator/staff role is represented by staff in the implementation. Its workspace contains Sales Overview, Sales & orders, Sales inbox, and Processing outcomes in demo mode. Drafts are excluded from staff lists, badges, processing requests, conversations, and direct draft access. Staff cannot create customer drafts through the web API.

Billing, Delivery, Inventory, and seller roles have their applicable operational/resolution permissions. Analytics and Mark issue as resolved require the Sales staff role. Customer registration cannot grant an operational role. Demo staff may simulate specified operational actions; live behavior uses the responsible roles and integration results.

## 3. Database design

### 3.1 Core entities

Customer stores customer_id, name, email, contact number, and creation time. A customer may have many orders; each order belongs to one customer.

Sales Order stores order_id, unique order_number, customer_id, seller_id, unique submission_reference, submission date, core order_status, product total, recipient name/contact/address, cancellation reason, and timestamps. A draft may contain no items; submission requires at least one valid item.

Order Item stores order_item_id, parent order/seller, offer_id, product_name_at_order, positive quantity, and unit_price_at_order. Order and offer are unique together. Re-selecting an offer increases quantity. Line total is calculated from quantity and accepted unit price.

Order Status History stores previous/new status, time, change source, actor reference, reason, and unique source-event reference when provided. One order can have many history entries.

Seller Offer is an external Catalog reference containing offer/product/seller identifiers, selling price, and active status. The demo includes Catalog reference tables; these do not transfer authoritative Catalog ownership to Sales.

### 3.2 Additive application records

- sales_user and sales_session: local authentication, role/customer association, session expiry, and CSRF token.
- sales_customer_profile: default recipient name and delivery address; customer contact fields remain in Customer.
- sales_payment_preference: preferred method for new orders.
- sales_order_payment: selected method for each order. Legacy prepaid records remain supported; current customer choices are GCash, bank transfer, and enabled COD.
- sales_order_facts: separate stock/payment/shipment facts, references, reservation metadata/expiry, reconciliation flags, and version.
- sales_outbox: uniquely referenced integration requests, payloads, processing state, retries, errors, and leases.
- sales_event: deduplicated service responses and their original payloads/request links.
- sales_simulator_result: repeatable demonstration results, not a live service ledger.
- sales_order_message: order-linked customer/Sales messages with sender and timestamp.
- sales_delivery_update: delay/redelivery updates, reasons, estimated timing, next update, and actor.
- sales_notification: customer-owned, deduplicated notifications and read state.
- sales_resolution: versioned per-order resolution JSON, including cancellation acceptance, refund/return/stock state, and issue-closure metadata.
- sales_resolution_history: unique resolution request IDs, action, actor/role, evidence details, and time.
- sales_refund_record: immutable externally completed refund evidence, unique reference, amount, method, actor, and time.
- sales_return_stock: one per-order stock-resolution reference, mode, evidence, and time.

### 3.3 Integrity and retention

Accepted product names/prices and submitted purchase details remain preserved. Monetary calculations use exact centavos/validated two-decimal amounts. Unique submission, event, request, refund, and restoration references protect against repeated processing. Versions protect against stale concurrent actions. Ordinary users cannot permanently delete submitted purchases and their history.

Displayed Unsuccessful and issue status are derived from recorded facts and resolution state; they must not be assumed to be extra values in the core order_status column. Current core statuses are draft, pending_stock, awaiting_payment, confirmed, fulfilling, completed, cancellation_pending, and cancelled.

## 4. Business rules and payment-dependent workflow

### 4.1 Preparation and submission

An order must reference a valid customer and active offers from one seller. Quantities are positive whole numbers. Recipient name, contact, address, and an available payment method are required before submission. The system calculates totals; a customer cannot supply an authoritative price or total.

When current prices differ from the reviewed prices, updated amounts must be presented and accepted. Submitted item quantities, prices, and recipient details are locked. Repeated submission returns the existing submission rather than creating another purchase.

### 4.2 GCash and bank transfer

1. Customer selects the method and submits the reviewed order.
2. Sales requests complete stock reservation from Inventory.
3. After successful reservation, Sales supplies accepted order details to Billing.
4. Billing verifies the full PHP payment; selecting a method does not prove payment.
5. Inventory confirms the valid reservation and fulfillment prerequisites.
6. Delivery accepts and performs fulfillment.
7. Sales records completion only with verified delivery and verified payment.

GCash and bank transfer require verified advance payment before shipment authorization. The present app does not itself execute a GCash payment or bank transfer.

### 4.3 Cash on Delivery

1. Customer selects COD before submission; an order cannot reach shipping without a selected method.
2. Inventory reserves stock and Billing creates the invoice/reference.
3. Valid stock confirmation and COD prerequisites permit fulfillment while collection is pending.
4. Delivery records the actual delivery result.
5. Billing verifies the cash collection. Only verified delivery together with verified payment qualifies as completed.

COD is enabled in the demo and requires ENABLE_COD=true for live configuration. Delivery success alone does not prove cash collection. If delivery occurred and collection failed, preserve Delivered history and resolve the payment issue separately; do not infer a failed delivery or returned goods.

### 4.4 Reservation expiry and unexpected results

Inventory defines reservation expiry. Expired or unconfirmed stock blocks shipment and starts the applicable cancellation/reconciliation path. A late verified payment remains a recorded payment fact and requires reconciliation; it does not automatically reactivate stock or authorize fulfillment. Timeouts remain unresolved until the original request is checked. Duplicate, outdated, unsigned, or contradictory service events must not silently advance an order.

## 5. Delivery, delays, and redelivery

A delay is an operational update with a reason and relevant estimated delivery/next-update information. It is not successful delivery or a terminal unsuccessful order. Customers review updates in their order and communicate through Contact Sales; Sales replies through the order conversation/Sales inbox.

An unsuccessful delivery attempt remains eligible for redelivery where permitted. Staff can arrange a new attempt and record its subsequent result through demo processing actions; live results must come from the responsible service. Each new attempt has its own request reference. Earlier failed results remain in history.

A redelivery may succeed, fail again, or lead to an explicitly stopped fulfillment/return process. Scheduling an attempt does not complete the order. Neither a failed attempt nor a delay alone should be treated as a final Unsuccessful outcome. Terminal cancellation or explicitly stopped unsuccessful processing prevents normal forward fulfillment.

## 6. Cancellation, unsuccessful outcomes, and resolution

### 6.1 Separate order outcome and issue status

The customer-facing order outcome retains Cancelled or Unsuccessful as applicable. Its separate issue status is Action required, In progress, or Resolved. Resolving an issue must never convert a cancelled/unsuccessful purchase into Completed, Successful, Fulfilled, or Delivered.

A cancellation request is not a confirmed cancellation. Stock-release and payment checks may leave cancellation pending. Paid cancellation requires explicit acceptance and the applicable refund/return/stock reconciliation. The original cancellation/failure reason remains visible.

### 6.2 Refund and return actions

Refund handling records required, processing, failed/retry, and recorded states. Recording completion requires evidence/reference, exact amount, confirmation, actor, and timestamp. Duplicate references and over-refunding are rejected. Refund evidence records an externally performed transaction; no money is automatically transferred.

Goods never dispatched require reservation release rather than a fabricated return. For dispatched goods that require return, record the return requirement and transit/handover evidence, then actual receipt and condition. Missing/damaged goods remain subject to resolution. Saleable receipt can support the appropriate Inventory restoration evidence. A prior Delivered fact may only be corrected through an explicit supported non-receipt process with Delivery evidence, while retaining history.

The demo can record one stock-restoration entry for an eligible saleable receipt. Live restoration requires responsible Inventory evidence; Sales does not directly modify external stock balances.

### 6.3 Mark issue as resolved

The administrator action appears in the order resolution section. Before confirmation, show outstanding cancellation, refund, return, stock, or payment requirements and their next actions. Require a short resolution note and explicit confirmation.

Each applicable requirement must either be completed through its own workflow or explicitly documented as externally completed/not applicable with the required explanation and reference. External issue documentation does not create a verified payment, refund receipt, return receipt, or stock movement by itself.

Save administrator identity, note, timestamp, evidence/dispositions, version snapshot, and audit history. Enforce authorization on the backend, persist after refresh, and prevent duplicate submissions. Closure writes issue metadata and notification only; it does not perform operational transactions.

Resolved labels are Cancelled · Issue resolved and Unsuccessful · Issue resolved. New authoritative facts can reopen review by invalidating the closure snapshot; prior closure evidence remains in history and normal fulfillment does not silently restart.

### 6.4 Progress, queues, and customer information

Preserve completed historical steps. Unperformed fulfillment steps on cancelled orders show Not applicable — Order cancelled. Preserve real delivery/return evidence for unsuccessful orders. Resolved banners say Order cancelled — Issue resolved or Order unsuccessful — Issue resolved.

Remove resolved cases from unresolved-issue queues/badges. Keep them searchable under the original outcome. Exclude stopped/resolved unsuccessful cases from active fulfillment and successful/completed totals. Customers see the resolution summary and an existing-system notification. A new customer conversation remains accessible in Sales inbox without falsely reopening completed fulfillment work.

## 7. Sales Overview and reporting

### 7.1 Access and period selection

Sales Overview is restricted to Sales staff/administrators; customers and other module roles cannot access its API or page. Today, Last 7 days, This month, and custom date filters use Philippine business time, Asia/Manila. Filters consistently apply to both chart panels and the associated metrics. Long ranges group collections monthly; shorter ranges retain daily buckets.

### 7.2 Financial definitions

Payments collected counts a verified PHP payment once per order using the matching dated Billing transaction reference and accepted amount. It includes money collected on subsequently cancelled/unsuccessful orders; those receipts are not labelled completed sales.

Refunds recorded sums unique completed external refund records within the period. Pending/failed attempts do not count. Net collections equals Payments collected minus Refunds recorded and may be negative when money collected in an earlier period is refunded now.

Completed orders require completed fulfillment, verified payment, verified delivery, and no cancelled/unsuccessful outcome, using the first recorded completion date. Recent sales lists the ten most recent eligible completed orders. Collections and completed sales use different event dates and must not be presented as identical measures.

### 7.3 Charts and product ranking

Payments collected uses #48A04C, a responsive approximately 300 px chart, rounded peso-axis intervals, subtle gridlines, spaced short date labels, and exact full-date/amount hover, keyboard-focus, and tap values. Zero-activity periods remain present. View trend values expands a readable secondary table. The plotted amounts reconcile to Payments collected.

Top-selling products replaces Order outcomes on the dashboard. It ranks the top five products by eligible completed units, groups offer snapshots by product identifier, and shows rank, readable/expandable product name, units, product sales amount, and quantity bars. Cancelled, unsuccessful, and draft orders are excluded. Current order-level return/refund records do not support item-level allocations; no returned quantity or product refund allocation is invented.

Sales & orders retains order status filters/counts. The obsolete Orders in progress percentage card is removed. Sales Overview alone uses white card headers, dark green titles, small green accents, an approximately two-thirds chart/one-third product layout on desktop, and vertical mobile stacking. The dark main banner remains. Other pages retain their existing section-header styling.

### 7.4 Reporting coverage

Unmatched or undated verification/completion records are excluded from period-specific totals and identified in coverage notes. An externally documented issue settlement does not enter collections until Billing records a matching verification. Reporting aggregates the full permitted matching dataset; the recent list alone is capped at ten rows.

## 8. Integration and security requirements

All services must share stable order/item/offer identifiers and agreed mappings. Requests and responses require unique references, agreed PHP precision, timestamp conventions, status meanings, and ownership. Sales stores outbound requests and deduplicated inbound events, handles retries/leases, and verifies applicable signed messages and freshness.

Inventory responses include reservation success/rejection, reference, expiry, confirmation, and release. Billing responses include invoice reference, payment amount/currency, transaction reference, and verification result. Delivery supplies acceptance, tracking, actual attempt/delivery outcomes, and return evidence where agreed.

Customer ownership, operational role checks, session/CSRF controls, stale-version rejection, and backend authorization apply independently of hidden buttons. Staff cannot bypass live authoritative stock/payment verification by selecting a visual outcome. Demo simulation is explicitly labelled and is not proof of external integration success.

## 9. Deployment, validation, and remaining agreements

SQLite demonstration tables are initialized additively. Existing MySQL deployments require the applicable profile, workflow, payment, communications, preference, and resolution migrations supplied by the project. Deployment must use the intended schema, role provisioning, integration secrets, and service configuration.

The current local verification includes 118 passing Node tests and Edge browser checks of desktop/mobile Sales Overview, filters, zero/sparse activity, exact-value tooltips, long names/large amounts, financial reconciliation, unchanged other-page headers, and customer denial. These results describe local application tests, not a live cross-team acceptance test. Supporting reviews/screenshots are under docs/ui-review/2026-10-23.

The teams must still confirm production identity/customer ownership, offer-to-stock mapping, reservation policy, COD availability/collection responsibility, paid-cancellation/refund authority, refund/return API contracts, Inventory restoration evidence, shipment/reattempt identifiers, and live response/security contracts. Item-level returns, additional charges, split fulfillment, and automated financial execution require separate agreed development.

## 10. Changes from the original proposal

The core purchase-record, accepted-price, reservation, history, and ownership principles remain. The revised scope adds payment preferences and COD, repeat delivery attempts, customer/Sales communication, paid-cancellation and refund/return evidence workflows, separate issue closure, private customer drafts in the staff workspace, and financial analytics. It replaces the original universal prepayment rule with method-dependent fulfillment and documents SQLite/MySQL implementation instead of an undecided Firebase/Supabase platform.
