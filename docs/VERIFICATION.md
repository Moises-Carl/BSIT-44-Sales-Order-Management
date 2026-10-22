# Verification performed

Latest local verification: **57 passing tests**, signed HTTP mock-service tests, actual desktop/mobile Edge workflow checks, and the corrected Inventory/cancellation screens. See [BUG_FIXES.md](BUG_FIXES.md) for the changes, evidence, screenshot names and remaining integration limits.

```powershell
npm.cmd test
node tests/browser-qa.mjs
```

Browser QA uses the installed Windows Microsoft Edge, an ephemeral local server, a temporary browser profile and an isolated in-memory demonstration database. It creates orders through supported workflows, saves screenshots in `data/screenshots/`, and closes its own browser/server. It does not change the user's persistent demo orders.

The original UI redesign checks remain documented in [UI_IMPROVEMENTS.md](UI_IMPROVEMENTS.md); its 38-test count describes that earlier stage. The latest suite adds regressions for confirmed non-expiring stock, canonical event comparisons, signed versioned Inventory lifecycle updates, cancellation flags and transport behavior.

MySQL and real external integrations remain unverified. Local mock/simulator success does not prove another group's implementation is compatible. See [INVENTORY_LIFECYCLE.md](INVENTORY_LIFECYCLE.md) for the implemented contract and [DECISIONS.md](DECISIONS.md) for policies requiring group agreement.
