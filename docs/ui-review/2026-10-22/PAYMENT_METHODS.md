# Payment methods and cash on delivery — 22 October 2026

Customers can choose **GCash**, **Bank transfer**, or **Cash on delivery** in Recipient details. The selected method is retained through Back/Continue, incomplete draft saves, reopening, review and submission. It appears in the order summary, review, order details, desktop order list and staff processing. Submission acceptance includes the method; submitted orders cannot change it.

## Processing rules

| Method | Successful demo sequence | Completion requirement |
| --- | --- | --- |
| GCash / Bank transfer | Reserve stock → Billing invoice → verify payment → confirm reservation → accept shipment → verify delivery | Verified payment and delivery |
| Cash on delivery | Reserve stock → Billing COD arrangement → confirm reservation → accept shipment → verify delivery → verify COD collection | Verified delivery and exact Billing-verified collection |

COD stays pending_stock while the stock/collection arrangement is prepared, then moves to confirmed and fulfilling using the existing statuses. No advance payment is required to ship a COD order. Inventory must still reserve and confirm every item. A confirmed demo hold has no automatic expiry; the initial unconfirmed reservation still has its existing 30-minute limit. Selecting COD does not turn an expired submitted prepaid order into a fresh reservation.

Delivery confirmation alone cannot mark COD paid or completed. It retains fulfilling with delivered shipment and pending payment until Billing verifies the invoice, amount, currency and transaction reference. Inventory may verify stock fulfillment after a COD shipment is accepted; that does not verify cash collection.

Failed COD collection preserves delivered shipment/stock facts, stops completion, and creates the existing persistent customer failure notification. It does not release delivered stock or offer unpaid cancellation. COD cancellation remains available before shipment, including confirmed unpaid COD orders, and still requires Billing cancellation and Inventory release. Cancellation becomes unavailable once shipment is accepted. Delivery failure never claims that COD payment was received.

## Persistence and integration

`sales_order_payment` is an additive table. Existing orders without a row retain the old prepaid behavior. Existing incomplete drafts keep their previous method when older clients omit the field. Draft updates validate allowed values; public clients cannot bypass prepaid checks by sending a COD flag on submission or a service event.

SQLite demo adds the table automatically. Existing MySQL installations must run **`npm.cmd run db:migrate-payment`** with MYSQL_URL configured before starting this version. Fresh db:init includes the table. No populated/shared database was reset or reinitialized.

Signed outgoing requests snapshot `payment_method`, `collection_due`, invoice/tracking references and current shipment fact alongside the unchanged purchase total, items and recipient. Inventory owns reservation and fulfillment; Billing owns payment/collection verification; Delivery owns shipment/delivery proof. All three methods use the existing simulator adapters in this demo. There is no actual GCash gateway, bank receipt processing, cash collection or external service verification in these checks.

Live COD is **disabled by default**. `ENABLE_COD=true` may enable it only after the participating services implement and agree the COD contract. Live mode retains signed external responses and never falls back to simulation. The setting is not proof of integration readiness. GCash and bank transfer are saved method preferences; live Billing still needs the corresponding payment instructions/provider integration.

## Verification

- Full `npm.cmd test`: 89 tests, including payment-method snapshots, immutable submission, COD collection ordering and amount checks, failed collection, cancellation timing, failed delivery, prepaid regression, live COD gating, forged-method protection and Inventory fulfillment with unpaid COD.
- `node tests/browser-payment.mjs`: actual Edge customer selection for all three methods, Back/Continue and saved-draft persistence, review/submission, full COD/GCash/bank-transfer workflows, delivered-but-not-paid state, failed COD collection and customer feedback. Separate fictional orders and isolated in-memory storage were used.
- `node tests/browser-accounts.mjs`: existing profile/default-recipient, incomplete/repeated/failed saves, leave guards, snapshot preservation and submission walkthrough passed after the field was added.
- Desktop 1440 × 1000 and mobile 390 × 844 captures were inspected. Mobile overflow assertions passed. The photo/draft divider and existing theme were preserved. Browser runtime exception collection was empty.

See [payment screenshots](PAYMENT_SCREENSHOTS.md) for image links, viewport metadata and descriptions. Real MySQL migration and real external payment/delivery integrations remain unverified.
