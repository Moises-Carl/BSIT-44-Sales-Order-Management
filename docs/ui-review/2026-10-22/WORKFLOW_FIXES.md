# Workflow follow-up — 22 October 2026

The [closed-outcome follow-up](CLOSED_OUTCOMES.md) supersedes the manual next-stage cancellation/release controls described here.

Completed the requested outcome form, stopped-work behavior, persistent customer notifications and Save draft navigation. The green/sage interface, existing customer/profile/draft/photo features, status values, purchase snapshots, totals, queue and service audit records remain intact.

## Staff processing

Open **Processing outcomes**, select the order, then choose a valid outcome for its **Current stage**. Successful, Unsuccessful and Cancel order appear only where supported. A reason shown to the customer is required for Unsuccessful and Cancel order. Apply outcome locks the controls while processing and refreshes the order from the backend. Drafts must be submitted first; completed/cancelled orders display **No further action available**.

| Stage | Successful | Unsuccessful | Cancellation |
| --- | --- | --- | --- |
| Stock reservation | All-item reserve | Stock rejected | Eligible unpaid order |
| Payment request | Invoice created | Not offered: no definitive invoice-failure contract | Eligible unpaid order |
| Payment verification | Exact payment verified | Payment failed; no automatic retry | Eligible unpaid order |
| Reservation confirmation | Paid reservation confirmed | Reservation expired; reconcile paid funds | Unavailable after verified payment |
| Shipment acceptance | Shipment accepted | Acceptance failed; payment retained | Unavailable |
| Delivery confirmation | Delivery verified with proof | Delivery failed; payment/tracking retained | Unavailable |
| Cancellation payment check | Verified cancelled and unpaid | Payment received; cancellation remains unresolved | Already pending |
| Stock release | Verified complete release | Not offered: unknown release must remain unresolved | Offered only if the unpaid order remains eligible |

The dropdown is a demo service-response control, not a staff override of external services. In integrated mode, only eligible cancellation is selectable; **Check service update** dispatches/queries the existing signed service adapter. Inventory, Billing and Delivery remain authoritative.

Technical details, raw JSON, payloads, queue references, attempt counts and internal error strings have been removed from rendered workflow pages. Useful order history and independent service results remain. Diagnostic data remains in its existing backend tables/logging.

## Stopping work and retaining history

Cancellation immediately blocks ordinary pending/processing requests and enqueues the existing Billing cancellation and Inventory release checks. It becomes cancelled only when both clear and no payment is verified. Paid conflicts stay in cancellation_pending with reconciliation guidance; no unsupported refund/cancellation is implied.

Definitive stock rejection, failed payment, reservation expiry and delivery failure stop automatic later processing. Failed payment coordinates Inventory release and has no automatic retry. Delivery failure keeps confirmed payment, stock and any accepted shipment history; it does not cancel the purchase. Unstarted later milestones display Not applicable with a short explanation. Completed milestones remain verified, including **Reserved, then released** after cancellation.

Worker guards reject ineligible work even if a stale pending request is present. Cancelled/completed stages cannot be edited. Exact repeated events are deduplicated; conflicting terminal results cannot silently replace prior facts. Late paid/reserved events during cancellation are retained for reconciliation and never restart fulfillment. Core order statuses are unchanged; failed delivery is an independent `shipment` fact.

## Customer notifications and drafts

Customers have a persistent Notifications page, unread counts, Mark as read, timestamps, safe reasons and links to order details/next actions. Rejection, definitive failure, cancellation requested and cancellation completed are recorded in the same transaction as their relevant state change. Payment/stock cancellation conflicts also notify. Notification keys and event deduplication prevent repeated delivery from creating duplicate notices. Reads serialize with workflow commits, so another request cannot observe a notice from a transaction that later rolls back. Ownership is checked for listing and marking read. The latest outcome also appears on My orders and details.

Save draft persists the current order, retains incomplete recipient fields, updates the existing draft, and returns to the role's order list filtered to Drafts with **Draft saved**. It does not submit, reserve stock or request payment. The unsaved-changes guard is cleared only after save success. Failure stays on the form, retains fields and offers retry through Save draft. The divider, step indicator and adjacent Continue action are preserved.

## Confirmed fixes and evidence

| Issue / reproduction | Resolution and verification | Screenshot |
| --- | --- | --- |
| Staff processing exposed separate simulation buttons and technical data. | One validated stage form; no technical section or raw diagnostics in rendered pages. Exact dropdown options asserted for each successful stage; customer processing API access returns 403. | [Desktop outcome form](ui-workflow-staff-stock-outcome-desktop.png), [mobile](ui-workflow-staff-stock-outcome-mobile.png) |
| A rejected/failed order lacked a consistent stopped-stage presentation. | Later work blocked; later milestones Not applicable; failure reason and customer notice committed together. | [Stock rejection](ui-workflow-staff-stock-rejected.png), [payment failure](ui-workflow-staff-payment-failed.png) |
| Delivery failure could not be represented independently of cancellation. | Verified failure fact, payment/tracking retained, no automatic completion. | [Delivery failure](ui-workflow-staff-delivery-failed.png), [mobile](ui-workflow-staff-delivery-failed-mobile.png) |
| Cancellation progress hid previously reserved stock. | Historical milestones retained and release shown separately; payment conflict does not claim successful cancellation. | [Completed cancellation](ui-workflow-staff-cancellation-completed.png), [paid conflict](ui-workflow-staff-cancellation-payment-conflict.png) |
| Customer outcomes disappeared across sessions and lacked read state. | Persistent, owned, deduplicated notification storage and read timestamps; reload/sign-in and other-customer isolation checked. | [Unread notices](ui-workflow-customer-notifications-unread.png), [read state](ui-workflow-customer-notifications-read.png), [isolation](ui-workflow-customer-notification-isolation.png) |
| Save draft stayed in the editor. | Successful save returns to the correct list with feedback; draft remains resumable and incomplete. Failed saves preserve fields. | [Customer saved draft](ui-workflow-customer-draft-saved-list.png), [staff saved draft](ui-workflow-staff-draft-saved-list.png), [reopened draft](ui-workflow-customer-reopened-draft.png) |
| Screenshot inspection found the reason label's CSS overrode its hidden attribute. | Scoped hidden styling; computed visibility asserted before/after choosing Unsuccessful. | [Conditional reason field](ui-workflow-staff-unsuccessful-reason-required.png) |

During development, the rendered walkthrough also caught a removed submission/dialog helper and premature test waits. The helpers were restored, waits now require the refreshed page, and customer submission/dialog regressions pass.

## Verification actually performed

- `npm.cmd test`: **79 tests pass**, covering existing rules plus stage options, stopped queues, failures, atomic notifications, read/ownership, reopen persistence, late/repeated events, cancellation races, integrated-mode restrictions and uncommitted-notification isolation.
- `node tests/browser-workflow.mjs`: actual Edge pages; customer incomplete draft save/reopen/submit; staff successful six-stage path; stock rejection; failed payment and release; checked cancellation; cancellation/payment conflict through the dropdown; failed delivery; unresolved result; both roles' draft return; duplicate-click lock; notification read/reload/sign-in/deduplication/isolation; absent technical UI; desktop/mobile overflow assertions.
- `node tests/browser-accounts.mjs`: registration, profiles/defaults, partial prefills, incomplete and repeated draft saves, failed-save field preservation, all leave-guard choices, Back/Continue, default snapshot isolation, final submission, and 320px/mobile layouts.
- `node tests/browser-qa.mjs`: existing login, filters/search/empty recovery, pagination, item selection, current-price acceptance, progress/history, cancellation/payment race, customer boundaries, keyboard focus, reduced motion and startup recovery.
- `node tests/browser-photos.mjs`: all six photos, both sellers, selected/review/detail views, missing/broken fallbacks, no external image requests and desktop/390px/320px overflow checks.

Browser suites used real local Edge and the application HTTP server with isolated demo databases; setup fixtures prepared separate incompatible orders. Normal outcomes, failures, cancellation/payment conflict and draft saves were applied through rendered controls. The general regression injects a prepared late payment event to test the race, and the workflow suite replays exact events to test deduplication. No unrelated persistent demonstration records were changed. No unexpected runtime exceptions were observed; intentional failed-save/photo/module tests remain distinguishable from application errors.

Screenshots were visually inspected using contact sheets and key full-size captures. Viewports are recorded per image in [the follow-up screenshot index](WORKFLOW_SCREENSHOTS.md); full-page captures can exceed viewport height. New captures use `ui-workflow-`, `ui-accounts-current-` and `ui-regression-` prefixes to preserve earlier evidence.

## Setup, integration boundaries and remaining limits

SQLite demo upgrades add the notification table automatically without resetting records. For an existing MySQL installation, configure MYSQL_URL and run **`npm.cmd run db:migrate-workflow`** before starting this version. It creates only the additive notification table; a fresh `db:init` includes it. Existing profile migration remains separate.

All captured Inventory, Billing and Delivery outcomes are simulated. Live mode never falls back to simulators. The new signed Delivery failure contract (`status: failed` for accept/verify_delivery) requires agreement with the Delivery owner before live use; verify_delivery failure must match the recorded tracking reference. No real MySQL migration or external service was exercised. No email/SMS or refund handling was added. These are integration verification limits, not blockers for the local demo.

### Expired reservation follow-up

The persisted demo orders could have pending Billing requests after their reservations expired. Those orders correctly offered only Cancel order, but the generic Order resolution label did not explain why. The stage now reads Reservation expired and explains that payment/delivery cannot continue, with cancellation and replacement-order guidance. The backend still blocks unsafe payment verification. The full 79-test suite and Edge workflow passed; desktop/mobile expiry screenshots were inspected. Existing demo orders were preserved and the running demo server was restarted.

Expiry progress also preserves the earlier reservation as Reserved, then expired and marks later work Not applicable. Screenshot inspection exposed a mobile grid placement issue for the extra stopped-stage explanation; its text now uses the description column. The Edge workflow passed again after that layout fix.
