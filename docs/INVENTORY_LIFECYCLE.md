# Inventory lifecycle contract — Sales implementation v1

This document describes locally implemented Sales behavior. The actual Inventory group still needs to supply an authenticated service and approve the proposed cross-system agreement. No stock balance is edited by Sales.

## Confirmed reservation validity

Inventory confirmation may explicitly return `expires_at: null` to mean a verified confirmed hold with no automatic expiry, matching the Inventory reference. The `expires_at` field must be present. The simulator now exercises this path. A future Unix-millisecond expiry is also accepted for compatibility with an explicitly expiring provider; omitted, malformed, or past confirmation expiries are rejected. Active unpaid reservations always require a future expiry.

The backend, dispatch guards, progress display, and cancellation checks use the same distinction. Existing cached expiring reservations retain their existing semantics; there is no rewrite of user orders or forced migration.

## Terminal results versus later lifecycle facts

Existing operation results still go to `POST /api/events/inventory`. A later expiry/release/fulfillment is a new fact, not a second terminal response to the reserve operation. Send it to:

```text
POST /api/events/inventory/lifecycle
```

Use the same Inventory HMAC headers and HTTPS policy as the existing service result endpoint. Only `INVENTORY_SECRET` authenticates this route. Customer/staff browser sessions cannot authorize it. Live webhooks remain disabled in explicit demo mode.

Example (fictional IDs; replace the occurrence timestamp at execution time):

```json
{
  "schema_version": 1,
  "event_type": "reservation.lifecycle",
  "event_reference": "inventory-order-42-v1",
  "request_reference": "sales:42:inventory:reserve",
  "order_id": 42,
  "version": 1,
  "status": "released",
  "occurred_at": 1792627200000,
  "reservations": [
    {
      "reservation_id": "res-101",
      "order_item_id": 101,
      "offer_id": 9,
      "quantity": 2
    }
  ]
}
```

- `version` is a positive integer increasing within one order’s Inventory reservation-lifecycle stream. One event reference per version. Preserve the original reference/version on retry.
- `request_reference` links to the original reserve request. The handler checks Inventory service identity, order ID, accepted reservation IDs, item IDs, offers and quantities. It never guesses unknown IDs or creates reservations.
- `occurred_at` is a positive Unix-millisecond timestamp no more than five minutes in the future. The HMAC request timestamp separately enforces message authentication freshness.
- Object field order and reservation array order are irrelevant. Required identities/quantities are exact; duplicate item/reservation identities are rejected. Different content under the same event reference remains a conflict.
- An exact semantic duplicate returns `{ "duplicate": true }`. An older lifecycle version is audited and returns `{ "ignored": true, "reason": "outdated_version" }` without regressing current facts. A reused version with a different event reference returns 409.
- `expired`: only an active/reserved unpaid hold may expire; the occurrence must be at or after its known deadline. A non-expiring confirmed hold cannot be expired. Sales marks the stock fact expired, pauses progress and blocks pending Billing/Delivery/confirmation requests.
- `released`: only a known reserved/confirmed/released hold may be reported released. A fulfilled/expired hold cannot be revived or released. Progress is paused for cancellation/reconciliation.
- `fulfilled`: requires a nonblank `fulfillment_reference`, known confirmed/fulfilled stock, verified payment, Delivery acceptance, eligible fulfilling/completed order state, and no reconciliation blocker. Inventory alone attests physical deduction. Sales records the fact and can still complete later on verified delivery.

A lifecycle release does **not** set `release_clear`: cancellation still requires the separate release request’s authoritative no-active-or-future-reservations/tombstone guarantee, plus Billing’s verified unpaid check. A late verified payment clears the earlier unpaid acknowledgement, keeps payment evidence, and leaves cancellation unresolved.

## Persistence and transactions

The handler reuses `sales_event` for event-reference deduplication, payload audit and lifecycle version history. No new table, destructive import, stock mutation, or migration is required for these fixes. Lifecycle facts, blocked requests and event audit commit atomically. Order-status history is unchanged when only service facts change. Remote network calls remain outside database transactions.

## Local verification versus remaining integration work

Tests cover non-expiring holds, canonical duplicates, unordered identity sets, stale/conflicting lifecycle versions, forged mappings/signatures, expiry and fulfillment guards, cancellation races, and signed HTTP request/query behavior against a local service mock. The browser verifies the corresponding stock and payment-reconciliation displays.

Real MySQL execution, credentials/grants, source-system identifiers, Inventory’s actual stock implementation, dispatch/pickup ownership, failed-payment policy and deployed service connectivity still require joint integration verification. The fixed Sales receiver does not prove another group implements the contract.
