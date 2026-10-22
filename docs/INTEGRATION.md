# Proposed integration contract

This is a runnable adapter contract for this Sales implementation, **not an approved class-wide API**. Catalogue uses the packaged MySQL read view. Inventory/Billing/Delivery HTTP services are not supplied. Implement/adapt their actual interfaces and agree the guarantees below before live use.

## Environment

Set `INVENTORY_URL`, `BILLING_URL`, `DELIVERY_URL` to each service’s base URL, ending with `/`, and a separate `INVENTORY_SECRET`, `BILLING_SECRET`, `DELIVERY_SECRET`. URLs require HTTPS outside local development. Secrets must be strong random values kept out of source control.

Live mode is the default (`npm start`); configuration absence causes an explicit error, never simulated success. `npm run demo` explicitly enables local simulators; signed live webhooks are disabled there.

## Authentication and delivery

All service responses, including not-found responses, and inbound events must be authenticated. Use headers:

- `x-sales-timestamp`: UTC Unix timestamp in **milliseconds**, within five minutes.
- `x-sales-signature`: lowercase hex HMAC-SHA256 of `timestamp + "." + exact UTF-8 body` using that service’s secret.

Sales signs outbound calls in the same way; GET has an empty body. POST includes `Idempotency-Key: <request_reference>`. Reject redirects, invalid signatures, and inconsistent references. Configure service clocks correctly. HTTPS is still required: signatures are not encryption.

The staff **Integrations** page dispatches a durable request outside a database transaction:

1. `GET <base>/requests/<encoded request_reference>` checks the original operation, even after a timeout.
2. An authenticated 404 permits `POST <base>/requests/<action>` with its original immutable JSON payload.
3. Return a signed terminal result, or `{ "status": "pending" }` while unresolved. Subsequent queries must return the same terminal result.
4. Services may asynchronously `POST /api/events/inventory`, `/api/events/billing`, or `/api/events/delivery` to Sales with signed results.

Events are **one terminal result per request**. This initial contract models invoice creation, payment verification, and delivery verification as separate operations, not unrestricted arbitrary status updates. A live adapter must wait/query for a terminal result rather than turn "pending" into failed. Payment failure means the initial order can be cancelled and recreated; payment retry on that same order is outside this first UI scope.

Sales uses a 60-second dispatch lease and 10-second HTTP timeout. Failed calls remain pending with the same request reference. An in-flight result can still arrive via a signed webhook. Query/retry safely. Unexpected contradictions require owning-service reconciliation, not manual edits to order status.

## Common payload and event envelope

Example outgoing reserve payload (all operations use the same basic envelope):

```json
{
  "request_reference": "sales:1:inventory:reserve",
  "order_id": 1,
  "customer_id": 1,
  "seller_id": 1,
  "currency": "PHP",
  "product_total": "179.00",
  "items": [{
    "order_item_id": 1,
    "offer_id": 1,
    "seller_id": 1,
    "product_name_at_order": "Everyday notebook",
    "quantity": 2,
    "unit_price_at_order": "89.50"
  }],
  "recipient": {"name": "Alex Santos", "contact": "09171234567", "address": "123 Test Street, Manila"},
  "reservation": null
}
```

Responses/events include `event_reference` (unique, maximum 100 characters), matching `request_reference`, numeric `order_id`, and operation-specific fields. Money must be decimal strings; never binary floats or implicit currency conversion. Item IDs and offer IDs are numeric. Timestamps for reservation validity are UTC Unix milliseconds.

## Operation results

| Service / action | Accepted result and required fields |
| --- | --- |
| inventory / reserve | `status: reserved`, future `expires_at`, and `reservations` containing every ordered item exactly once with `order_item_id`, `offer_id`, matching `quantity`, unique nonblank `reservation_id`. Or `status: rejected`, optionally `short_items`. No partial success. |
| billing / invoice | `status: created`, nonblank `invoice_reference`, `amount` equal to the accepted product total, `currency: PHP`. |
| billing / verify | `status: verified` or `failed`, matching `invoice_reference`, matching `amount`, `currency: PHP`; verified results also require `transaction_reference`. |
| inventory / confirm | `status: confirmed`, explicit `expires_at: null` (non-expiring) or a valid future expiry, and the same complete reservation identities/quantities in any order; or `status: expired`. Confirmation follows verified payment and must attest all original reservations remain valid. |
| delivery / accept | `status: accepted`, nonblank `tracking_reference`, `order_item_ids` matching the requested ordered item IDs. Acceptance is eligible only with verified payment and valid confirmed reservation. |
| delivery / verify_delivery | `status: delivered`, matching `tracking_reference`, nonblank `proof_reference`. The Delivery service verifies actual proof before returning it. |
| billing / cancel | `status: cancelled_unpaid` only after authoritatively blocking pending/future charges for this order and proving no successful payment; or `status: paid` for reconciliation. |
| inventory / release | `status: released`, `no_active_reservations: true` only after releasing all reservations and preventing a delayed reserve/confirm from re-creating them. |

Example reservation event:

```json
{
  "event_reference": "inventory-event-001",
  "request_reference": "sales:1:inventory:reserve",
  "order_id": 1,
  "status": "reserved",
  "expires_at": 1893457800000,
  "reservations": [{"order_item_id": 1, "offer_id": 1, "quantity": 2, "reservation_id": "r-001"}]
}
```

Use actual future validity rather than the illustrative timestamp. The Sales API verifies service identity, request/order correlation, current state, amounts, item mappings, and event uniqueness inside one local transaction. Semantically identical duplicate events return a no-op independent of JSON object key order; conflicting duplicate references and outdated terminal results are rejected. Event payloads and errors are retained for audit/reconciliation.

## Cancellation and races

Cancellation is a coordination protocol, not a stock or payment edit. Sales first enters `cancellation_pending`, blocks fulfillment, and requests Billing cancellation plus Inventory release. Only both authoritative acknowledgements permit `cancelled`. Receiving "no reservation currently found" alone is insufficient: a reserve request might still be in flight. Services must implement order-level cancellation/release tombstones or equivalent guarantees across all request references.

A paid result during cancellation, a paid result after stock expiry, or a contradictory late reservation produces a visible reconciliation message and blocks fulfillment. No automatic refund, paid cancellation, stock deduction, or invented release is attempted. Service contracts that cannot guarantee final unpaid cancellation or prevent future reservations must leave the cancellation unresolved and require reconciliation.

Confirmed order cancellation and automatic reconciliation are outside the initial scope. Inventory owns expiry, release and eventual physical stock deduction. Delivery’s proof is authoritative. Payment/shipment state remains separate from the overall Sales status.

## Delivery and total boundaries

Sales sends known order/item/offer/customer/recipient references only. Weight, dimensions, physical pickup address, delivery service, and shipping charges are absent from the reference SQL. A real Delivery adapter must obtain authoritative values from the relevant groups or refuse booking. It must not invent them. Billing uses the product total only until an agreed additional-charge contract is implemented.

## Local API overview

Authenticated browser endpoints: `GET /api/orders` (search/status/from/to), `POST /api/orders` (draft), `GET/PUT /api/orders/:id`, `POST /api/orders/:id/review`, `/submit`, `/cancel`, `GET/POST /api/customers`, `GET /api/offers`. Submission needs the exact review `acceptance`, `version`, and a stable unique `submission_reference`.

Staff only: `GET /api/operations/requests`, `POST /api/operations/dispatch` with `request_reference` and demo-only `outcome`. Demo outcomes are success, timeout, stock/payment rejection, stock confirmation expiry, and a cancellation-time paid result. Browser mutations require the session’s `x-csrf-token`; customer IDs supplied by a browser do not override account ownership.

## Implemented Inventory lifecycle updates

Sales now supports non-expiring confirmed holds, order-independent reservation/item matching, canonical event deduplication, and the signed versioned `POST /api/events/inventory/lifecycle` receiver. See [INVENTORY_LIFECYCLE.md](INVENTORY_LIFECYCLE.md) for the exact envelope, sequencing, validation, cancellation guarantees, and remaining external agreements. Later lifecycle notifications use that endpoint rather than overwriting an original request’s terminal result.
