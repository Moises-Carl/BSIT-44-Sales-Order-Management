# Integration review — findings for implementation

This is a static review of the packaged documents and SQL, not an execution test or approved class agreement. It introduces no migration by itself. Distinguish document facts from recommended provisional policies.

## Established by the supplied sources

- The combined PDF and SQL define Catalogue and Sales together: category, product, seller, seller_offer; customer, sales_order, order_item, order_status_history.
- Systems 3–5 are not incorporated into that SQL.
- Original Catalogue identifies offers by seller/product. The combined schema adds offer_id and retains seller/product uniqueness.
- Combined SQL enforces single-seller orders using composite foreign keys and defines v_orderable_offer based on active offer/product/seller status. This is catalogue orderability, not stock availability.
- SQL supports price/name snapshots, exact DECIMAL amounts, generated line totals, submission/event uniqueness, and history records. Backend processing must implement the rest of the business rules.
- Sales proposes prepayment, locked submitted purchase details, stock reservation before Billing, valid stock plus verified payment before fulfillment, and one shipment per order.
- Inventory proposes all-or-nothing reservation, 30-minute unpaid expiry, reservation confirmation following payment, and deduction at dispatch.
- Billing maintains payment status separately from order status and mentions COD integration where applicable.
- Delivery describes pickup-triggered deduction, shipping charges, COD, proof of delivery, and order-linked integration data.
- Folder materials do not establish that any live application or integration is complete.

## Differences and missing contracts

| Topic | Evidence / concern | Required handling |
| --- | --- | --- |
| Platform | Combined SQL is MySQL; Sales/Inventory retain Firebase/Supabase discussion | Inspect actual project; do not infer class approval |
| Offer identity | Composite seller/product versus offer_id | Agree IDs or explicit mapping across modules |
| Field names | current_price/selling_price and status/seller_status differ | Match actual contract and adapt deliberately |
| Failed payment | Sales allows retry; Inventory describes release | Choose consistent reservation/retry policy |
| Deduction timing | Dispatch versus pickup | Agree one authoritative event and deduplicate it |
| COD | Sales prepayment versus Billing/Delivery COD references | Exclude initial COD or implement an agreed complete lifecycle |
| Charges | Sales product total versus Delivery charges | Preserve subtotal; define final amount and timing with Billing |
| Delivery linkage | Order IDs mentioned in interface text but absent from listed shipment fields | Explicit order/item references or mapping required |
| Customer ownership | Sales and Delivery both list customers | Shared identity or documented cross-system mapping |
| Physical metadata | Delivery needs weights/dimensions/pickup data absent from combined schema | Obtain authoritative data; do not invent it |
| Product participation | Original Catalogue permits products without offers; combined prose says each needs an offer | Preserve original listing distinction; only actual active offers are purchasable |
| Existing-order deactivation | Combined PDF proposes existing submitted orders remain unaffected | Confirm policy; do not cancel orders based on current catalogue status alone |

## Provisional implementation defaults

Reuse the existing application stack. If none exists and no other evidence is supplied, implement a straightforward MySQL-compatible web application with documented local setup. Use one seller/order, all-or-nothing reservation, verified prepayment, one shipment/order, and PHP money. Exclude paid cancellation/refunds/returns/COD initially. Record these as provisional, not approved decisions.

Status values: draft, pending_stock, awaiting_payment, confirmed, fulfilling, completed, cancellation_pending, cancelled. Maintain separate payment, stock-reservation, and shipment facts. Legal transitions require backend checks; string constraints do not enforce workflow.

Coordinate cancellation and payment/expiry races without silently losing verified payment or authorizing fulfillment without valid stock. Timeouts are unresolved, not evidence of success or rejection.

## Information to obtain from the actual project

- Working source code and setup instructions.
- Actual database platform/schema and permitted access method.
- Authentication/roles and authoritative customer model.
- Catalogue API or database read contract and sample data.
- Inventory reservation/confirmation/release interface.
- Billing verification interface and amount conventions.
- Delivery authorization/event interface and reference mappings.
- Confirmed policies for expiry, payment failure, COD, charges, cancellation, and deduction event.

Codex should build independent authorized work while these are unavailable, use explicit local simulation only for missing services, and report exact integration limits.
