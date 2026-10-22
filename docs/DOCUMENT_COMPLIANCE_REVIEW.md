# Review against the combined System 1 / System 2 document

Reviewed 2026-10-22. This is an assessment, not a code change or a certification of a live shared ERP.

## Reference and evidence

The newly supplied Facebook CDN URL could not be opened by the web tool. Review therefore uses the retained `references/00_combined/System_1_and_2_Document.pdf` and its `text_extracts/Combined_Integration.txt` in the nested reference package, plus the original SQL, current application source, and executed tests.

The packaged PDF is 272,089 bytes (265.71 KiB), with SHA-256 `29fde37e26a486a3fd262e151892b2826d34eecdf59fa1a4953522211d26c641`, matching the package manifest. Its title and displayed size match the supplied reference, but the inaccessible remote file could not be independently checked for changes.

Overall finding: the assigned Sales module follows the main documented purchase rules. The running SQLite demonstration is not the exact MySQL deployment specified by the document. Catalogue management and cross-group database permissions are not implemented/verified by this Sales application.

## Sales rules (document section 6.2)

| Rule | Finding | Evidence |
| --- | --- | --- |
| S-01 Unique order ID/number | Implemented | Database PK/unique order number and generated order reference. |
| S-02 Existing customer | Implemented | `Sales.normalized` validates existence and account ownership; order FK. |
| S-03 Recipient and at least one item | Implemented at submission | `Sales.quote` requires items and nonblank recipient/contact/address. Incomplete/empty drafts remain allowed. |
| S-04 Positive whole quantities | Implemented | Integer/range validation, quantity CHECK, tests. |
| S-05 Duplicate selection increases quantity | Implemented | Draft normalization groups offers; UI increments quantity; unique order/offer constraint. |
| S-06 Submitted items locked | Implemented through supported API | `Sales.save` rejects non-drafts; accepted item/name/price snapshots cannot be edited by UI/API. Direct privileged SQL is outside that protection. |
| S-07 Correct line/order totals | Implemented in business logic; schema difference in demo | Server calculates integer centavos and stores decimal strings. Original MySQL SQL has generated `line_total`; SQLite demo omits that generated column and derives displayed line totals. |
| S-08 Repeated submissions return existing order | Implemented for retries of the same submission reference | `Sales.submit` returns the existing order on the same reference; concurrent different references cannot double-submit. |
| S-09 Apply external event once | Implemented | Unique event records, identical-duplicate no-op, conflicting/outdated result rejection. |
| S-10 History for accepted transition | Implemented | `Sales.transition` writes state and history atomically. |
| S-11 Retain submitted order/items/history | Implemented through supported API | No submitted-order deletion endpoint. Item deletion in `Sales.save` is restricted to draft replacement. |

## Integration rules (document section 6.3)

| Rule | Finding | Evidence / qualification |
| --- | --- | --- |
| I-01 One seller/order | Implemented | Server validation plus original composite FKs; SQLite demo preserves the composite relationship. |
| I-02 Offer/product/seller active | Implemented | `v_orderable_offer` is checked during draft save and submission review/recheck. |
| I-03 Current price/name snapshot at submission | Implemented | `Sales.submit` rechecks the quote and writes final item snapshots in its transaction. |
| I-04 Later Catalogue updates do not alter submitted items | Implemented | Snapshot tests change later price/name and verify original submitted purchase remains intact. |
| I-05 Show changed total and require acceptance | Implemented | Server quote/acceptance comparison; UI current-price checkbox, reset and reacceptance after changes. Browser scenario verifies changed-price rejection and reacceptance. |
| I-06 Deactivation does not cancel submitted orders | Implemented policy, still provisional | No Catalogue-deactivation cancellation handler; submitted processing uses purchase snapshots. The PDF explicitly requires group agreement for this policy. |
| I-07 Sales read-only on Catalogue | Application boundary implemented; database enforcement missing | Normal live Sales paths only read Catalogue. Explicit demo initialization inserts fictional Catalogue data. No MySQL GRANT/revocation setup or runtime privilege verification is provided. Fresh database initialization needs its own privileged setup context. |
| I-08 Catalogue cannot write Sales | Not verifiable here | Requires separate group database accounts and restricted privileges in the real shared deployment. |
| I-09 PHP and two decimals | Implemented | PHP currency, integer centavo calculations, decimal-string amounts; original MySQL schema retains DECIMAL precision. |

## Catalogue rules (document section 6.1)

Catalogue CRUD, seller/product/offer status management, product participation, and Catalogue administration belong to System 1. This project intentionally implements the assigned Sales module and reads Catalogue; it is not a complete System 1 management application.

The original MySQL schema retained for fresh installation contains category/product/seller uniqueness, offer seller/product uniqueness, foreign keys, status/price constraints, and the active-offer view. Their actual MySQL execution is unverified.

In particular, C-08 (deactivating a seller also deactivates its stored offers) is not a Sales feature. The view correctly hides offers from inactive sellers even if the offer row itself remains active; that does not implement Catalogue’s own cascade-deactivation rule. C-04 (each product needs an offer) is also an application-level Catalogue rule, not established merely by the provided SQL.

The explicit SQLite demo does not replicate every Catalogue uniqueness/enum/price constraint from the original MySQL SQL. It must not be presented as an exact schema-conformance deployment.

## Concrete remaining gaps / qualifications

1. Deploy and test the original schema on MySQL 8.0.16+ or compatible MariaDB with enforced CHECK constraints. The current running demonstration uses SQLite; its money storage and generated-column behavior differ.
2. Establish separate setup/runtime/Catalogue database accounts. Grant Sales read-only access to Catalogue and grant Catalogue no write access to Sales. Application ownership boundaries alone do not prove I-07/I-08 database enforcement.
3. Connect System 1’s actual data/implementation and confirm its Catalogue-only rules. Do not add Catalogue administration to the assigned Sales module merely to fill another group’s scope.
4. Minor section 7 usability mismatch: unavailable-item errors identify an offer ID rather than consistently listing the product names. Rejection is enforced, but the document asks to name unavailable items.
5. Confirm the document’s section 8 agreements: offer IDs/field mapping, seller linkage, existing-order deactivation policy, customer ownership, server hosting/accounts, and shared DB versus API access. These are not proven by a local demo.

Inventory, Billing, and Delivery tables are expressly outside this combined document’s current schema. Their simulated status in the demo must remain disclosed, but is not itself evidence of violating a requirement to implement those tables in this PDF.

## Verification executed for this review

`node --test --test-concurrency=1 --test-reporter=dot tests/sales.test.mjs tests/ui.test.mjs` passed all 38 tests. These use isolated SQLite data and verify the covered business/UI rules; they do not validate MySQL permissions, class-wide agreements, or live external systems. No application behavior or persistent user data was changed during this review.
