# Mini-ERP Sales/Order — Codex handoff

## Start here

1. Extract this ZIP into or alongside the actual Mini-ERP project folder.
2. Open that project folder in Codex. This archive contains reference materials, NOT runnable application source code.
3. Give Codex this instruction:

   Read `MiniERP_Sales_Order_Codex_Package/CODEX_PROMPT.md` and follow it. The reference files are inside that same package. Inspect the actual project first, then implement and verify our Sales/Order Management module.

If you place the package folder elsewhere, adjust that relative path. You can also paste the full contents of CODEX_PROMPT.md directly into Codex.

## Contents

- `CODEX_PROMPT.md`: complete implementation instructions and project context.
- `INTEGRATION_REVIEW.md`: prior static-review findings and unresolved group agreements.
- `references/00_combined/`: original combined integration PDF and SQL.
- `references/01_catalogue/`: all nine Catalogue reference PNGs.
- `references/02_sales/`: original Sales DOCX.
- `references/03_inventory/`: original Inventory PDF.
- `references/04_billing/`: Billing Google Docs export(s), with format identified by extension.
- `references/05_delivery/`: original Delivery PDF.
- `text_extracts/`: convenient extracts from source documents, not substitutes for diagrams/tables.
- `SOURCE_MANIFEST.json`: source origins, format, byte size, and SHA-256 for every packaged file except the manifest itself.

## Important limits

The reviewed sources are designs and proposed agreements. They do not prove another group's app is finished, that a shared database exists, or that the interfaces have been implemented. The combined SQL covers Systems 1 and 2 only. Do not import it destructively into an existing database. No live application, database credentials, API secrets, or actual project source code is included.

MySQL, prepayment, one seller per order, and one shipment per order must be checked against the actual project and group agreements. Missing integrations may be represented only by explicitly configured development simulators, never silently presented as real services.

References were retrieved from the supplied links for this handoff on 2026-10-21. Source documents were retained unchanged; generated prompt, review, manifest, and text extracts are handoff aids. Public links can change, so use packaged files as the reviewed snapshot and inspect newer implementation evidence if available.
