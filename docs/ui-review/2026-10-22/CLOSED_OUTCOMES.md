# End processing after cancellation or failure — 22 October 2026

Cancellation and definitive unsuccessful outcomes now close the normal order-processing flow. They show **Processing ended** with the actual condition and customer-facing reason, such as **Order cancelled due to Customer no longer needs the items** or **Order unsuccessful due to Requested notebook is unavailable**. There is no next-stage outcome dropdown.

Order lists, details and staff processing use the same derived condition. Unsuccessful orders display an Unsuccessful badge and are excluded from active-order totals. Earlier verified stock/payment/delivery facts and history remain; later stages stay Not applicable. Unknown or timed-out service responses remain unresolved rather than being called unsuccessful.

In demo mode, an accepted cancellation automatically runs the existing Billing cancellation and Inventory release adapters. It becomes cancelled only after those responses verify the requirements. Failed payment automatically coordinates its queued demo stock release. These checks are no longer presented as a next Successful/Unsuccessful stage.

If checks are unresolved, a separate resolution area can retry only Billing cancellation or Inventory release. It cannot dispatch normal reservation, payment, shipment or delivery stages. A verified payment conflict closes processing but remains **Cancellation needs reconciliation**, preserving the paid fact; it is never falsely marked cancelled, delivered or successfully completed. Live mode keeps service results authoritative and does not automatically simulate clearance.

The existing backend order-status values are preserved. “Processing ended” and “Unsuccessful” describe existing cancellation/service facts; they do not change a rejected purchase into a successfully completed delivery. No new migration is required for this follow-up.

## Verification

- `npm.cmd test`: **94 tests pass**, including automatic demo cancellation checks, automatic release after failed payment, paid conflicts, unresolved live checks, blocked further outcomes and staff/customer authorization for resolution.
- `node tests/browser-workflow.mjs`: successful processing; stock/payment/delivery failures; immediate checked demo cancellation; late paid conflict; the screenshot's paid-conflict plus pending release scenario; separate release retry; unchanged paid fact; absent next-stage dropdown; customer reasons; mobile layout and no overflow. Screenshot review also caught and removed a misleading unknown-result notice from definitively closed orders.
- `node tests/browser-payment.mjs`: GCash, bank-transfer and COD paths and failed COD collection still work with closed-outcome presentation.
- `node tests/browser-qa.mjs`: general order-list, pricing, progress, cancellation, history and access regression passed.

All browser scenarios used fictional, isolated test records. Desktop viewport was 1440 × 1000 and mobile 390 × 844, with full-page captures. Each PNG has a JSON sidecar containing its actual viewport, role and route. Key desktop/mobile captures were visually inspected.

| Screenshot | Evidence |
| --- | --- |
| [Unsuccessful stock reservation](ui-workflow-staff-stock-rejected.png) | Failure reason, stopped later stages, closed processing form |
| [Failed payment](ui-workflow-staff-payment-failed.png) | Failed payment and automatically released demo stock; no next outcome |
| [Cancelled order](ui-workflow-staff-cancellation-completed.png) | Cancellation reason and historical reservation/release; no next stage |
| [Paid conflict with pending stock release](ui-workflow-staff-ended-conflict-release-pending.png) | The reported scenario now has a closed-processing summary and separate resolution area |
| [Paid conflict on mobile](ui-workflow-staff-ended-conflict-mobile.png) | Mobile closed state without an outcome dropdown |
| [Stock release verified after conflict](ui-workflow-staff-ended-conflict-release-verified.png) | Payment remains verified and order does not advance or claim final cancellation |
| [Failed delivery](ui-workflow-staff-delivery-failed.png) | Preserved payment and shipment history; processing ended |

Real integrations and MySQL were not exercised. Existing demo records were preserved when loading the new code.
