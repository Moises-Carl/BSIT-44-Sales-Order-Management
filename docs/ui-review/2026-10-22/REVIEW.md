# Staff workspace and guided demo review — 22 October 2026

Historical baseline. The [workflow follow-up](WORKFLOW_FIXES.md) supersedes the Technical details UI and success-button workflow described below; original evidence is retained.

The staff dashboard now prioritizes monitoring and coordination. Demo operations guides one selected fictional order through real pending integration requests. Existing customer accounts, profile defaults, incomplete drafts, photos, recipient/price snapshots, totals and backend lifecycle rules are retained. The pre-existing draft action divider and active-order styling were preserved.

## Roles and dashboard

Customers have My orders, Create order, saved drafts, My profile/default recipient details, their own progress/history and eligible cancellation requests. Staff have all permitted customer orders, operational next steps, service facts, cancellation coordination and order creation on a customer's behalf. The existing `admin@example.test` login has the `staff` role; no administrator role was added.

Staff shortcuts cover all orders, drafts, pending stock, awaiting payment, confirmed, fulfilling, cancellation requests, needs attention and completed. Needs attention is derived from reconciliation, unresolved request errors or expired active reservations; it never changes an order status. Customer ownership is applied before filtering on the backend.

Summary cards describe the filtered results. Shortcut counts describe the latest 500 permitted orders before filters. Submitted product value excludes drafts and cancelled orders and does not mean money received. Dates/limits are explained in collapsed filter help. Filtered empty states explain the missing status and offer Clear filters.

## Use the demo

1. Run `npm.cmd run demo` and sign in as Sales team with the documented fictional account.
2. Submit a fictional order, then open Demo operations. Search/select its readable number and customer, or open Demo operations from its details.
3. Review the progress and independent Inventory, Billing and Delivery facts. Use the single next simulation action.
4. The successful path is stock reservation → Billing invoice → payment verification → Inventory reservation confirmation → shipment acceptance → delivery verification. Each button corresponds to an existing pending backend request. Payment alone cannot skip stock confirmation.
5. For a separate problem order, expand Test a problem. Stock rejection, failed payment, expiry during confirmation and unresolved response appear only for requests that support them. Expected effects appear before the buttons. Delivery failure is omitted because the current backend cannot represent it.
6. During requests, simulation controls and selection are disabled. Responses refresh authoritative order/request data. Unresolved responses retain the same reference for retry; rejected/expired stock pauses fulfillment and directs staff to order details. Eligible cancellation retains the existing Billing and Inventory checks.
7. Completed/blocked operations are collapsed under history. Technical details retains request references, attempts, payloads, errors and recorded simulator responses. Queue rows, event history and retries are retained. Selected-order requests are fetched separately so unrelated queue rows cannot crowd them out.

## Confirmed issues and verification

| Page / role | Reproduce and actual behavior | Expected / fix | Evidence and result |
| --- | --- | --- | --- |
| Order list / staff | Sign in as staff: panel instructed staff to find a purchase or resume shopping. | Operational wording and customer coordination actions. | [Staff dashboard](ui-staff-orders-desktop.png); browser pass. |
| Dashboard / staff | Try to find cancellation, fulfillment or unresolved orders: shortcuts were missing and attention counted only reconciliation. | Additional shortcuts; backend derived attention includes unresolved requests and expiry, retaining ownership. | [Attention view](ui-staff-attention-filter.png); focused backend isolation/expiry/retry test passes. |
| Order list / staff | Select an empty status: generic empty copy and technical notes occupied the main screen. | Status-specific explanation, clear recovery and collapsed help. | [Empty pending stock](ui-staff-empty-pending-stock.png); browser recovered using Clear filters. |
| Demo operations / staff | Open operations after submission: raw IDs, repeated completed requests and outcome selectors dominated the queue. | Readable selected order, verified progress, next pending action, optional scenarios, collapsed history/details. | [Before reservation](ui-staff-demo-before-inventory-reserve.png), [completed](ui-staff-demo-completed.png); all six actions performed in Edge. |
| Simulator API / staff | Send an unsupported result, e.g. `expired` for stock reserve or `reject` for shipment acceptance: simulator could silently return success. | Reject unsupported combinations before recording a response. | `unsupported problem scenarios` backend regression passes; no invalid success result recorded. |
| Demo operations / staff | Rejected stock retained its pending-stock backend status; a generic next-action message gave little recovery guidance. | Preserve status; show rejected Inventory fact, attention and paused-processing guidance with order details/cancellation path. | [Rejected stock](ui-staff-demo-stock-rejected.png); separate failure order used in Edge. |
| Demo operations / staff | Reopen operations from another order's details: remembered selection could show the previous order. | Detail navigation selects the inspected order. | Edge assertion confirms selection after opening the rejected order and returning to operations. |
| Dashboard / staff, desktop | Inspect the expanded shortcut row: the last attention shortcut was clipped at the panel edge. | Wrap shortcuts on desktop; retain touch scrolling on mobile. | [Empty status dashboard](ui-staff-empty-pending-stock.png); final browser run passes with wrapped desktop tabs. |

## Checks actually performed

- `npm.cmd test`: 66 backend/UI/HTTP tests pass, including ownership, public privilege escalation, sessions/CSRF, lifecycle transitions, cancellation races, duplicate events, snapshots, derived attention, unsupported simulator outcomes and scoped request details.
- `node tests/browser-accounts.mjs`: registered a fictional account; saved profile/default recipient; verified prefills; saved incomplete draft; left/reopened it; tested Keep editing, Discard and Save and leave; changed profile without overwriting draft snapshots; navigated Back/Continue; tested failed-save preservation and duplicate-save lock; reviewed/submitted and verified recipient snapshot preservation.
- `node tests/browser-qa.mjs`: customer/staff sign-in, lists, search, status filters, pagination, status-specific empty recovery, current-price acceptance, full successful demo flow, independent stock rejection, attention inspection, customer cancellation on a separate unpaid order, history and verified milestones, denied customer operations API, keyboard focus and reduced motion. Staff demo search and detail-to-operations selection are asserted.
- `node tests/browser-photos.mjs`: six local photos, both sellers, selection/review/details, fallback behavior and no external image requests. No unexpected runtime exceptions in browser suites. Photo failure tests intentionally request broken images; startup recovery intentionally blocks a module.
- Desktop viewport 1440 × 1000; mobile 390 × 844, plus 320px layouts where recorded in the index. Overflow assertions passed. Screenshots are full-page captures, so image height can exceed viewport height.
- Reviewed screenshot contact sheets and opened key full-size dashboard, mobile, saved-recipient/divider, resumed-draft and rejected-stock captures. Fixed the clipped desktop shortcuts found in that review; no remaining overlapping content was confirmed. Browser tests use the application HTTP server and real Edge with isolated in-memory demo databases; unrelated persisted demo records were not changed.

## Boundaries and limits

Catalogue owns products/current prices, Inventory reservations, Billing payment verification and Delivery shipment/delivery results. Sales owns the purchase and lifecycle. All captured service results are simulated; no real integration or MySQL connection was verified.

Demo mode explicitly uses a separate SQLite database, binds to loopback and refuses production. Live mode uses MySQL and signed external adapters without simulator fallback; live and demo orders do not coexist in the supported storage configuration. No unrestricted staff status/payment override was added. Customer routes/APIs remain protected by backend ownership/staff checks and registration cannot assign privileges.

The current staff role can view all Sales orders; no finer staff tenancy model exists. Lists/selectors retain the 500-record limit. External reconciliation, real refunds and delivery-failure simulation remain outside this change. Initial sandboxed Edge runs stalled; the completed walkthroughs used approved local browser execution outside the sandbox. This was a tooling constraint, not an application failure.

See the [complete screenshot index](SCREENSHOTS.md) for relative image links, role, page, exact viewport and description. Screenshots contain fictional records and exclude registration/password entry captures and session tokens.
