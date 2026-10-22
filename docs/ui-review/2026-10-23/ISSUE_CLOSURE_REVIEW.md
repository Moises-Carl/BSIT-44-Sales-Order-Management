# Explicit issue closure

Implemented an admin-only mark_resolved resolution action with mandatory note, confirmation, actor and timestamp. Required cancellation/refund/return/stock/payment work is listed with next actions. Outstanding requirements need individual external-completion or not-applicable notes and references before closure; source transaction facts remain unchanged. Duplicate request IDs are idempotent, and versions prevent stale submissions.

## Verification

- Full Node test suite: 113 tests. Dedicated tests cover paid cancellation and refund completion, required evidence, COD delivery preserved after payment failure, duplicate closure, customer/Billing denial, original-status search, unchanged source facts, and review reopening on late payment.
- Edge with the real HTTP app: both screenshot scenarios reproduced using fictional data in an isolated in-memory database. Paid cancellation tested before/after closure; genuine delivered COD with failed payment tested before/after externally documented settlement. Refresh persistence and customer summary/notification verified. Premature closure was rejected with a specific requirement. Customer mutation returned 403.
- Resolved cases excluded from attention queue, active fulfillment and completed totals; Unsuccessful search retained the order. Desktop/mobile overflow checks passed.
- Screenshots do not represent real money transfers or external Inventory actions. Existing local user records were not mutated by browser tests.

## Screenshots

- [ui-issue-closure-cancelled-after-desktop.png](ui-issue-closure-cancelled-after-desktop.png)
- [ui-issue-closure-cancelled-after-refresh-mobile.png](ui-issue-closure-cancelled-after-refresh-mobile.png)
- [ui-issue-closure-cancelled-before-desktop.png](ui-issue-closure-cancelled-before-desktop.png)
- [ui-issue-closure-customer-resolution-summary-mobile.png](ui-issue-closure-customer-resolution-summary-mobile.png)
- [ui-issue-closure-resolved-excluded-from-queue-desktop.png](ui-issue-closure-resolved-excluded-from-queue-desktop.png)
- [ui-issue-closure-unsuccessful-after-desktop.png](ui-issue-closure-unsuccessful-after-desktop.png)
- [ui-issue-closure-unsuccessful-after-refresh-mobile.png](ui-issue-closure-unsuccessful-after-refresh-mobile.png)
- [ui-issue-closure-unsuccessful-before-desktop.png](ui-issue-closure-unsuccessful-before-desktop.png)
