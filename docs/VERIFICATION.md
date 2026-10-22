# Verification performed

Latest local verification: **57 passing tests**, signed HTTP mock-service tests, actual desktop/mobile Edge workflow checks, and the corrected Inventory/cancellation screens. See [BUG_FIXES.md](BUG_FIXES.md) for the changes, evidence, screenshot names and remaining integration limits.

```powershell
npm.cmd test
node tests/browser-qa.mjs
```

Browser QA uses the installed Windows Microsoft Edge, an ephemeral local server, a temporary browser profile and an isolated in-memory demonstration database. It creates orders through supported workflows, saves screenshots in `data/screenshots/`, and closes its own browser/server. It does not change the user's persistent demo orders.

The original UI redesign checks remain documented in [UI_IMPROVEMENTS.md](UI_IMPROVEMENTS.md); its 38-test count describes that earlier stage. The latest suite adds regressions for confirmed non-expiring stock, canonical event comparisons, signed versioned Inventory lifecycle updates, cancellation flags and transport behavior.

MySQL and real external integrations remain unverified. Local mock/simulator success does not prove another group's implementation is compatible. See [INVENTORY_LIFECYCLE.md](INVENTORY_LIFECYCLE.md) for the implemented contract and [DECISIONS.md](DECISIONS.md) for policies requiring group agreement.


## Customer account and draft update

61 backend/HTTP/presentation tests pass. Both `node tests/browser-qa.mjs` and `node tests/browser-accounts.mjs` pass in local Edge. See [account/draft verification](ACCOUNTS_AND_DRAFTS.md) for the complete coverage, screenshots, additive migration and live deployment limits.


## Local product photos and sage presentation

63 tests pass, including Catalogue-priority/demo-isolation and unsafe-URL/HTML-escaping checks. Existing order and account Edge walkthroughs pass. `node tests/browser-photos.mjs` verifies both sellers/all six local assets, thumbnails in selection/selected/review/details, square contain layout, alt text, missing/broken fallbacks, no external image requests, and no horizontal overflow at desktop/390px/320px. Screenshots were visually reviewed; tall-image bounds were corrected and checked again. Sources, hashes, licensing and exact Catalogue limitations are in [PRODUCT_PHOTOS.md](PRODUCT_PHOTOS.md).
