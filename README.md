# CampusERP — Sales / Order Management

A local university Sales module with a responsive browser interface, authenticated staff/customer accounts, locked submitted purchases, exact PHP product totals, status history, and durable integration requests.

## Run the demonstration (no installation or MySQL required)

Requires Node.js 22.14 or newer. In a terminal opened in this folder:

```powershell
npm.cmd run demo
```

Open **http://127.0.0.1:3100**. Stop with Ctrl+C.

| Account | Email | Password |
| --- | --- | --- |
| Sales staff | admin@example.test | CampusDemo2026! |
| Customer Alex | alex@example.test | CampusDemo2026! |
| Customer Jamie | jamie@example.test | CampusDemo2026! |

The page also provides demo sign-in buttons. Demo data persists in `data/demo.sqlite`; tests use independent, temporary in-memory databases. Demo mode binds to loopback and refuses `NODE_ENV=production`. Node may print an experimental SQLite warning on version 22; this is expected.

**Every demo Catalogue record, reservation, payment, and shipment is simulated.** Simulator controls are restricted to the staff **Demo operations** page. Customer accounts can only access their own orders. No real integrations have been verified.

## Demo walkthrough

1. Choose **Try a demo account** on the login page and select Sales team. Use **Create order** to enter the three-stage flow.
2. **Select items:** choose one seller and add products. Selecting an offer again increases its quantity. Continue to recipient details.
3. **Recipient details:** staff can select/create a customer; customer accounts automatically use their signed-in identity. Enter recipient name, contact, and address. Values are retained when moving back.
4. **Review order:** continuing saves the draft and checks current names/prices on the backend. Explicitly accept the details and total, then submit. Changed prices require a fresh acceptance. You can save a draft earlier and continue it later.
5. Open **Demo operations** as staff. Simulate Inventory / Reserve, Billing / Invoice, Billing / Verify, Inventory / Confirm, Delivery / Accept, and Delivery / Verify delivery, in that order as each appears.
6. The order moves through `pending_stock`, `awaiting_payment`, `confirmed`, `fulfilling`, and `completed`. Open it to see verified milestones, separate service facts, immutable purchased items, and full history.
7. To demonstrate cancellation, cancel a draft or an unpaid submitted order and enter a reason. Submitted cancellation remains pending until Billing / Cancel and Inventory / Release both verify the requirements. Simulating late payment keeps it unresolved for reconciliation.
8. A simulated timeout remains unresolved and retries use the original reference. Customer accounts see only their own orders and cannot enter the authorized operations area.

See [docs/UI_IMPROVEMENTS.md](docs/UI_IMPROVEMENTS.md) for the improved-screen walkthrough, verification details, and screenshot locations.
## Tests

```powershell
npm.cmd test
# Focused example:
node --test --test-name-pattern="cancellation" tests/sales.test.mjs
```

Tests cover centavos, draft edits, merged quantities, mixed sellers, invalid orders, inactive Catalogue data, changed-price acceptance, snapshot preservation, duplicate/concurrent submission, event deduplication, stock timeouts/rejections, payment amount/source checks, expiry, cancellation races, status history, customer isolation, authentication, CSRF, and HTTP assets.

## MySQL setup (separate from demo)

Use a dedicated **empty** database, MySQL 8.0.16+ or compatible MariaDB with enforced CHECK constraints. A database administrator must create the database and a restricted application account. Never run initialization on a populated/shared database.

```powershell
npm.cmd ci --ignore-scripts
$env:MYSQL_URL = 'mysql://mini_erp_user:YOUR_PASSWORD@127.0.0.1:3306/mini_erp'
$env:ADMIN_EMAIL = 'your-team@example.edu'
$env:ADMIN_PASSWORD = 'YOUR_UNIQUE_LONG_PASSWORD'
npm.cmd run db:init
npm.cmd start
```

Initialization checks the database is empty **before DDL**. It uses the packaged original Catalogue/Sales schema without dropping tables or changing its constraints, creates additive Sales integration/authentication tables, and creates the initial staff login. It inserts **no** demo Catalogue data. MySQL DDL is not transactional: if initialization is interrupted, inspect the resulting dedicated schema before continuing; the tool will refuse to rerun over it.

Environment variables are read from the process. `.env.example` is a template; `.env` is not loaded automatically. On Node 22, `node --env-file=.env src/server.mjs` explicitly loads a local environment file. Do not commit credentials.

Catalogue must provide authoritative `category`, `product`, `seller`, `seller_offer`, and `v_orderable_offer` data in the agreed shared MySQL schema. Sales only reads Catalogue in normal operation. The separate demo database seeds fictional Catalogue data explicitly. If Catalogue has an independent database or API, implement its adapter/mapping before live use.

Staff can create customer contact records in the draft editor. Provision a corresponding customer login from a trusted terminal:

```powershell
$env:NEW_USER_EMAIL = 'customer@example.edu'
$env:NEW_USER_PASSWORD = 'A_UNIQUE_LONG_PASSWORD'
$env:NEW_USER_CUSTOMER_ID = '1'
node src/create-user.mjs
```

Use HTTPS and `NODE_ENV=production` for deployment so cookies are Secure. `PUBLIC_ORIGIN` may specify your exact HTTPS reverse-proxy origin. This project has not been deployed. Password reset, email verification, and a shared campus identity provider remain future integration work.

## Integration configuration and limits

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the proposed signed HTTP contract, request/event examples, cancellation guarantees, and unresolved agreements. Set each service URL and a separate strong shared secret before dispatching live requests. Live mode never falls back to simulation. Staff dispatch requests from **Integrations**; this release does not run an automatic background worker.

See [docs/DECISIONS.md](docs/DECISIONS.md) for provisional defaults and verification limits, and [migrations/README.md](migrations/README.md) before integrating an existing database.

## Structure

- `src/sales.mjs`: transactional business rules and state transitions.
- `src/db.mjs`: MySQL adapter and explicitly isolated SQLite demo schema/data.
- `src/integrations.mjs`: request leases, signed HTTP transport, and development simulators.
- `src/server.mjs`: HTTP API, sessions, CSRF, role checks, and static assets.
- `public/`: responsive login, order list, draft editor, review, detail, cancellation, and staff operations.
- `tests/`: executable backend and HTTP regression tests.
- `MiniERP_Sales_Order_Codex_Package/`: original reference package, retained unchanged.

For the recorded verification results, see [docs/VERIFICATION.md](docs/VERIFICATION.md). On this Windows machine you can rerun the full browser walkthrough with `node tests/browser-qa.mjs`; it uses the installed Edge browser and closes its temporary browser/server afterward.


## Share with your group

See [GitHub and groupmate setup](docs/GITHUB_SETUP.md) for uploading this repository, inviting collaborators, cloning, and running the local demo.

