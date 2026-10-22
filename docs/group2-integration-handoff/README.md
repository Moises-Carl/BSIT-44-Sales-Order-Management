# Group 2 integration handoff

Prepared by Group 2 (Sales & Order Management) for review with the owners of Systems 1, 3, 4 and 5. The full technical handoff and supporting files are included. Only the formal approval/sign-off sections have been removed; the technical decision list and joint acceptance tests remain.

## Contents

1. Group_2_Integration_Handoff.pdf — shareable handoff.
2. Group_2_Integration_Handoff.docx — editable Word handoff.
3. Group_2_Integration_Handoff.md and .html — source and printable HTML.
4. schema-map.csv — identifiers, ownership and Sales mappings.
5. examples.json — fictional request/result examples; replace identifiers and regenerate time-sensitive fields before use.
6. Group_2_Revised_System_Specification.docx — detailed Sales application scope.
7. System12_BASELINE_REFERENCE_ONLY.sql and System_1_and_2_BASELINE_REFERENCE.pdf — unchanged supplied baseline references.

Do not run the baseline SQL as an upgrade against an existing database. It creates the original System 1/2 tables, not the complete current application or Systems 3–5. Use the appropriate reviewed migrations on staging.

## Review by system

- System 1: section 4 — Catalogue access, offer IDs, prices and active status.
- System 3: section 5 — reservations, expiry, COD holds, deduction/release/restoration.
- System 4: section 6 — invoices, verification, COD collection, cancellation and refunds.
- System 5: section 7 — shipment authorization, item links, tracking/proof, redelivery and returns.
- All systems: sections 8–12 — transport/security, workflows, reporting boundaries, joint tests and technical decisions.

Bring actual schema/API samples, identifier mappings, test environment details and normal/failure responses. Share credentials privately; none are included here. System numbers identify modules; confirm the actual team contacts together.

## Source and validation notes

The user-supplied PDF and SQL match the packaged reference copies by SHA-256. Their content and current Sales implementation were reviewed. The Google Drive folder was inaccessible; this package does not claim review of its latest files.

Baseline PDF SHA-256: 29FDE37E26A486A3FD262E151892B2826D34EECDF59FA1A4953522211D26C641
Baseline SQL SHA-256: 31E7C6720A07FA2D0E14B132ACE57B544C7F3BF17DFD061D736A7445196765CD

Implementation sources: src/sales.mjs, src/integrations.mjs, src/payment.mjs, src/resolution.mjs, src/overview.mjs, src/db.mjs and src/server.mjs. Supporting documentation: docs/INTEGRATION.md, docs/INVENTORY_LIFECYCLE.md and docs/system-documentation/Sales_Order_Management_Mini-ERP_Revised.md. Older prepayment-only statements are superseded by current method-dependent implementation described in the handoff.

Word XML, PDF generation, JSON parsing, baseline hashes and archive contents were checked. This task changed documentation only. Live service connectivity, live MySQL execution and cross-team acceptance remain to be verified together. No materials were sent to other people or uploaded externally.
