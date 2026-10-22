# Sales-side integration bug fixes

Implemented and locally verified 2026-10-22. This resolves the four reproduced audit findings without claiming that the real external systems are connected.

## Fixed

1. **Confirmed-stock validity:** explicit NULL expiry is supported for non-expiring confirmed holds. Active unpaid holds still require expiry; omitted/malformed/past confirmed expiries remain invalid. Existing expiring records retain their semantics. Backend guards, simulator and UI agree.
2. **Later Inventory updates:** authenticated `POST /api/events/inventory/lifecycle` v1 handles expiry, release and verified fulfillment separately from original terminal request results. Complete identities, eligible states, event uniqueness, per-order versions and occurrence times are checked. Stale versions are audited without regressions. Lifecycle release alone cannot bypass cancellation tombstone checks.
3. **Semantic comparisons:** JSON object key order no longer creates duplicate-event conflicts. Confirmation matches complete reservation identities independent of array order. Shipment acceptance matches an exact item set. Changed quantities, IDs, duplicate items and conflicting content remain rejected.
4. **Paid cancellation display:** late verified payment clears the previous unpaid acknowledgement; UI also defensively rejects contradictory legacy flags. Paid cancellation remains unresolved for reconciliation and cannot complete or authorize fulfillment.
5. **Related validation:** malformed draft item/customer values produce validation problems, UTF-8 request bodies are decoded consistently for signatures, unavailable-item errors include the saved product name, and valid zero-price offers are not labeled unavailable in the item editor.

No Inventory balances, payment records, or shipment records are invented or modified by Sales. No user data was reset and no destructive SQL/migration was executed. The lifecycle implementation reuses the existing Sales event audit table; no new persistence table is needed for these fixes.

## Verification actually performed

- `node --test --test-concurrency=1 --test-reporter=dot tests/sales.test.mjs tests/ui.test.mjs`: **57 passed** (46 backend/HTTP tests and 11 presentation-rule tests).
- Signed HTTP adapter exercised against an actual local HTTP mock: authenticated GET/not-found, immutable idempotent POST, query-before-retry, and rejection of an invalid response signature.
- Lifecycle HTTP endpoint tested with invalid and valid Inventory signatures and duplicate callbacks. Browser/customer sessions do not authorize these updates.
- `node tests/browser-qa.mjs`: actual Edge checks passed, including all earlier login/order/role/mobile cases plus non-expiring confirmed progress, Inventory expiry display and paid-cancellation reconciliation wording.
- Updated screenshots: `data/screenshots/ui-confirmed-no-expiry.png`, `ui-inventory-expired.png`, `ui-cancellation-payment-reconciliation.png`, alongside the existing desktop/mobile walkthrough screenshots. QA uses isolated in-memory data and closes its own server/browser.
- Integration PDF regenerated as version 0.2: 19 A4 pages, correct page count and zero detected content/footer overlap. Proposed SQL remains unexecuted.

## What remains external

Real Catalogue/Inventory/Billing/Delivery endpoints, identifiers, shared secrets and deployed service contracts; Inventory stock engine/expiry worker and agreed deduction event; MySQL execution, account grants, approved group policies and end-to-end integration testing. These remain to be verified with the other groups. Passing local tests is not a guarantee that no undiscovered defect exists.

Read `INVENTORY_LIFECYCLE.md` for the exact implemented receiver and `system3-integration/System_1_2_3_Inventory_Integration.pdf` for the updated group handoff.
