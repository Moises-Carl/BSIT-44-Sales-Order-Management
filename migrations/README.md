# Database safety

`npm run db:init` is a **fresh-database installer**, not an in-place migration. It refuses to run if any table exists. It reads the retained original SQL, skips CREATE DATABASE/USE so the configured dedicated database is used, and executes its Catalogue/Sales tables and view unchanged. It then creates additive tables declared in `src/db.mjs` under `extensions(true)`:

- `sales_user`, `sales_session`: role/customer mapping and opaque sessions.
- `sales_order_facts`: separate reservation/payment/shipment facts, draft version, cancellation acknowledgements, reconciliation message.
- `sales_outbox`: immutable requests with unique references, attempts, leases, unresolved errors.
- `sales_event`: deduplicated authenticated service results.
- `sales_simulator_result`: unused in live mode; stores only explicit demo adapter responses in demo mode.

No DROP/TRUNCATE, destructive import, or automatic ALTER is provided. MySQL DDL can leave a partially initialized schema if it fails; inspect it rather than rerunning blindly. Runtime transactions atomically update Sales orders, items, history, facts, requests, and events.

For an existing database: obtain its actual schema and migration conventions, back it up, compare IDs/statuses/constraints with the reference, agree ownership and mappings, and apply a reviewed additive migration. Backfill facts for existing orders only after verifying their payment/reservation/shipment state; never assume success. Original constraints and all existing purchase history must be preserved.
