# Sales Overview review

## Implemented

Removed the entire Orders in progress percentage card. The order page retains three balanced count cards. Sales Overview is the first Sales sidebar link for the existing staff role (administrators and sales staff); customer and module-specific roles cannot access the endpoint.

The dashboard has Today, Last 7 days, This month to date and custom date ranges, shared across cards/charts/tables in Asia/Manila (UTC+8). It includes collection/refund/net cards, completed order count, collection trend with zero buckets, mutually exclusive submitted-order outcomes, top five completed-sales products and ten recent completed sales with order links. Main banner remains dark green; section headers use #48A04C with high-contrast dark ink per this request.

## Accounting basis

- Payments collected: one verified PHP payment per submitted order, matched to its stored Billing transaction reference and amount. The first matching accepted Billing verification/paid event supplies the recorded date. Cancelled and unsuccessful payments remain included in collections.
- Refunds recorded: immutable completed external-refund records, dated by their recording timestamp. Failed/pending attempts and duplicate references do not add refund totals.
- Net collections: selected-period collections minus selected-period recorded refunds. A refund of prior-period money can make this negative. These figures are not labelled gross/net sales, so cancelled-order refunds are not subtracted from a completed-sales base that excluded those payments.
- Completed orders/product sales/recent sales: currently completed orders with verified payment and delivered shipment, using their first stored completion timestamp. Cancelled, unsuccessful and issue-resolved negative outcomes cannot become sales. Product values use saved item prices, excluding delivery charges, taxes and other fees (none are present in this order model).
- Outcome counts: current mutually exclusive outcomes of orders submitted in the selected window. Drafts excluded; issue closure preserves the original outcome. This submitted cohort can differ from completion-date sale counts.
- Full datasets are aggregated; only the top-five ranking and recent-ten display are capped. No arbitrary 500-order cap.

## Verification

- Full automated suite: 118 tests passed (data/overview-all-tests.txt). Five dedicated tests cover timezone boundaries, invalid dates, duplicate records, completed/cancelled/unsuccessful exclusion, partial period cash movement, zero/monthly grouping, failed refund exclusion, actual lifecycle/refund reconciliation, role denial and 505 completed orders.
- Running website: node tests/browser-overview.mjs with real local HTTP routes and Edge against an isolated demo database. No existing user transactions were created or changed.
- Reconciled stored test records: PHP 268.50 collected, PHP 89.50 refunded, PHP 179.00 net collections, one completed order with two notebooks / PHP 179.00 product sales. Resolved COD payment failure remained Unsuccessful, with its external closure note excluded from payment collections. Outcomes were one each Active, Completed, Cancelled and Unsuccessful.
- Checked every preset/custom filter, empty periods, twelve zero-inclusive monthly buckets, Refresh after source updates, recent-order navigation, loading/error/retry, customer API 403 and hidden analytics navigation, section colors and desktop/mobile overflow.
- Filters persist in the session. Reopening/refreshing fetches current data; a visible idle overview also refreshes every 60 seconds.

## Data limits

Unmatched/undated verified payment records and undated completions are not assigned invented dates; coverage notes disclose them. Refunds are order-level: no product-level refund allocation is invented, and product rankings are before order-level refunds. Externally documented issue settlements do not become verified payments until Billing records them. No external payment transfer or Inventory action occurs from viewing the dashboard. Live MySQL/integration execution was not verified. Existing staff have the global Sales order scope; customer and specialized module roles are denied analytics.

## Screenshots

- [ui-sales-overview-custom-zero-desktop.png](ui-sales-overview-custom-zero-desktop.png)
- [ui-sales-overview-empty-desktop.png](ui-sales-overview-empty-desktop.png)
- [ui-sales-overview-error-desktop.png](ui-sales-overview-error-desktop.png)
- [ui-sales-overview-loading-desktop.png](ui-sales-overview-loading-desktop.png)
- [ui-sales-overview-monthly-desktop.png](ui-sales-overview-monthly-desktop.png)
- [ui-sales-overview-orders-rebalanced-desktop.png](ui-sales-overview-orders-rebalanced-desktop.png)
- [ui-sales-overview-populated-desktop.png](ui-sales-overview-populated-desktop.png)
- [ui-sales-overview-populated-mobile.png](ui-sales-overview-populated-mobile.png)
