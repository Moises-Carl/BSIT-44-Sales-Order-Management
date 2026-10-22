# Sales Overview visual refinement — 23 October 2026

Implemented in the existing application, with no dependency or schema changes.

- Replaced Order outcomes and the duplicate product table with Top-selling products: five products ranked by completed units, saved product sales amounts, quantity bars, and keyboard/touch expandable full product names.
- Preserved completed-order eligibility and date filtering. Cancelled, unsuccessful and drafts are excluded. Current return records are order-level, with no item quantities/allocation; cancelled/unsuccessful returns are excluded through order eligibility. No item-level returns or refund allocation were invented. The ranking's supporting label exposes the existing refund-allocation limitation.
- Payments collected now has a responsive 300 px SVG, rounded peso intervals, subtle gridlines, #48A04C bars, sparse readable short date labels, and exact dated hover/focus/tap values. Every zero period remains present with zero-height bars.
- Scoped white headers, green accents, padding, summary-card alignment and responsive chart layout to Sales Overview. The dark page banner and other pages' solid green headers remain.

## Verification

Edge browser exercised the real HTTP application using an isolated in-memory demo database at 1440 px desktop and 390 px mobile widths. It verified all date presets and custom ranges, zero sales, single-day activity, monthly buckets, no overlapping desktop date labels, no horizontal page overflow (including the expanded values table), five ranked products, long product names, large amounts, actual touch events, keyboard focus and pointer tooltips. Chart total reconciled to the Payments collected summary. Refresh, error recovery, recent-order navigation, unchanged order-page headers and customer API/route denial passed. No existing business records were changed by these tests.

The running local server on port 3100 serves the updated implementation. Financial aggregation/permission tests and the full Node suite were also run; see data/overview-refinement-tests.txt.

## Screenshots

- [Finished desktop](ui-sales-overview-refined-desktop.png)
- [Finished mobile, with full product name expanded](ui-sales-overview-refined-mobile.png)
- [Empty period](ui-sales-overview-custom-zero-desktop.png)
- [Single-day mobile](ui-sales-overview-populated-mobile.png)
- [Monthly buckets](ui-sales-overview-monthly-desktop.png)

Screenshots contain fictional test data; saved transactions on the local demo were not modified.
