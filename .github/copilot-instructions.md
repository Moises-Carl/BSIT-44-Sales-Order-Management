# Copilot instructions

## Project context

This checkout is a handoff/specification package for the Mini-ERP Sales/Order module, not a runnable application. Before implementing features, inspect the actual application source, its setup instructions, framework, database, authentication, and existing tests if they are present in the working tree. The package's implementation brief is `MiniERP_Sales_Order_Codex_Package/MiniERP_Sales_Order_Codex_Package/CODEX_PROMPT.md`; its source and scope notes are in `README_START_HERE.md`. Treat `INTEGRATION_REVIEW.md` as analysis, not an approved class-wide contract.

## Build, test, and lint

No application source, dependency manifest, test suite, or build/lint scripts are included in this checkout, so there are no verified build, test, lint, or single-test commands to run here. Do not invent commands. If application code is added, follow its actual manifests and documentation, and record the exact full-suite and focused/single-test commands there.

The SQL reference is `MiniERP_Sales_Order_Codex_Package/MiniERP_Sales_Order_Codex_Package/references/00_combined/System1_and_2.sql`. It requires MySQL 8.0.16+ or MariaDB 10.2.1+ for enforced `CHECK` constraints. It creates a database and tables; do not run it against a populated or shared database without an explicitly approved, safe migration plan.

## Architecture and ownership

The Mini-ERP design comprises five cooperating systems: Catalogue, Sales/Order, Inventory, Billing/Payment, and Delivery/Shipment. Each system owns its operational data; other systems coordinate through agreed interfaces rather than editing those records directly:

- Catalogue owns categories, products, sellers, offers, current prices, and catalogue status.
- Sales owns customer purchase records, ordered items, accepted name/price snapshots, product totals, and overall order status/history.
- Inventory owns stock balances, reservations, expiry, release, deductions, and movement history.
- Billing owns invoices, payment attempts and verification, transaction references, and refunds.
- Delivery owns shipments, courier/tracking data, delivery events, and proof of delivery.

The supplied combined SQL implements only Catalogue and Sales tables. Inventory, Billing, and Delivery are described in separate references, not implemented by that schema. Do not infer that any service, database, or integration is live just because a document describes it. Read the original references when a diagram, table, or contract detail matters; text extracts are navigation aids.

## Domain invariants and conventions

- An order belongs to one seller. The combined schema reinforces this with `seller_id` and composite foreign keys between `sales_order`, `order_item`, and `seller_offer`; retain this invariant or provide an explicit agreed mapping if the actual project uses different identifiers.
- Purchases reference real seller offers. A new order is orderable only when its offer, product, and seller are active (`v_orderable_offer`); that view says nothing about stock availability.
- Preserve the accepted product name and unit price on each submitted item. Submitted purchase details are historical snapshots, not live catalogue data. Calculate money exactly using decimal values or integer centavos, not floating-point arithmetic.
- The schema's order states are `draft`, `pending_stock`, `awaiting_payment`, `confirmed`, `fulfilling`, `completed`, `cancellation_pending`, and `cancelled`. Validate legal transitions in application logic and append status history; do not expose arbitrary status editing. Payment, reservation, and shipment states remain owned by their respective systems.
- Treat retries and integration events as potentially repeated, delayed, or out of order. Validate their source, order, amount, and current state; use stable idempotency references and do not treat timeouts as success or rejection.
- Do not cross module ownership boundaries to fake an integration. If a required service is unavailable, use only a clearly configured and labeled development adapter; never silently fall back to simulated stock, payment, or delivery in production.

## Decisions that remain provisional

The packaged documents contain unresolved or proposed choices, including MySQL versus Firebase/Supabase, customer ownership, payment-failure/reservation-expiry behavior, COD, shipping charges, cancellation, and whether inventory is deducted at dispatch or pickup. The combined SQL and integration review are not proof that these choices were approved. Follow actual application contracts and documented group decisions; otherwise keep a local implementation policy explicit and provisional. Do not invent shared contracts, physical delivery data, or completed integrations.
