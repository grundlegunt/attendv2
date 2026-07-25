# Seat Reservation Engine Design

Status: Draft v1 — this is the most correctness-critical subsystem in the platform.
Related: STATE_MACHINES.md (SeatHold, TicketOrder), DATA_MODEL.md

## 1. Non-negotiable invariant

**No `ShowtimeSeat` may ever back two non-refunded `Ticket` rows.** Every design choice below exists to guarantee this under concurrent load, network failure, and partial success. Postgres is the source of truth. Redis is an accelerant and a UX layer (fast reads, TTL countdowns, pub/sub fanout) — it is never the last word on whether a seat is available.

## 2. Why Redis alone is insufficient

Redis-only holds (e.g., `SETNX seat:{id} sessionId EX 480`) are fast and simple, but: Redis eviction/restart can lose state; a Redis failover can briefly serve stale data; and critically, the *purchase* step (confirming payment and marking SOLD) is a multi-step operation (charge card, then persist ticket) that must not race against another purchase attempt on the same seat even if both passed the Redis hold check moments apart. Redis is used for what it's good at — hold TTL bookkeeping and pub/sub — while Postgres enforces the actual constraint.

## 3. The three moments that must be concurrency-safe

### 3.1 Selecting a seat (creating a hold)

```
BEGIN;
SELECT status FROM showtime_seats WHERE id = :id FOR UPDATE;
-- application checks: status must be AVAILABLE (or HELD by an already-expired hold)
UPDATE showtime_seats SET status = 'HELD', current_hold_id = :newHoldId WHERE id = :id;
INSERT INTO seat_holds (...) VALUES (...);
COMMIT;
```

`SELECT ... FOR UPDATE` takes a row lock, so two simultaneous requests for the same seat serialize: the second request's `SELECT` blocks until the first transaction commits, then re-reads the now-`HELD` status and correctly fails with "seat unavailable." This is the mechanism that makes "two people click C4 at the same instant" resolve to exactly one winner deterministically, not probabilistically.

After commit: write the hold to Redis with a TTL (`hold:{showtimeSeatId} = holdId`, `EX 480`) purely so the countdown/expiry sweep has a fast trigger, and publish `SEAT_HELD` to the `showtime:{id}` room. Every subscribed client (customer seat map, box office) repaints that seat immediately.

### 3.2 Confirming payment (the purchase)

The purchase transaction re-validates ownership of the hold before trusting it:

```
BEGIN;
SELECT ss.status, sh.expires_at, sh.id
FROM showtime_seats ss JOIN seat_holds sh ON sh.id = ss.current_hold_id
WHERE ss.id = :id FOR UPDATE;
-- application checks: hold belongs to this checkout session AND now() < expires_at
UPDATE showtime_seats SET status = 'SOLD', current_ticket_id = :ticketId, current_hold_id = NULL WHERE id = :id;
UPDATE seat_holds SET released_at = now(), release_reason = 'COMPLETED' WHERE id = :holdId;
INSERT INTO tickets (...) VALUES (...);
UPDATE payments SET status = 'SUCCEEDED' WHERE id = :paymentId;
COMMIT;
```

This is one database transaction. Payment confirmation from Stripe happens *before* this transaction opens (we only ever mark SOLD after the processor has told us the charge succeeded — see PAYMENT_FLOW.md), and the transaction itself is what makes seat-sold + ticket-created + payment-succeeded atomic from the rest of the system's point of view. If any statement fails, everything rolls back, including — importantly — never partially issuing a ticket without a sold seat or vice versa.

A partial unique index enforces the invariant at the schema level as defense in depth, independent of application logic being correct:

```sql
CREATE UNIQUE INDEX ux_ticket_active_seat
ON tickets (showtime_seat_id)
WHERE status NOT IN ('REFUNDED', 'CANCELED');
```

If application logic somehow tried to insert a second live ticket for the same seat (a bug, a race the row lock didn't catch due to an unexpected isolation issue), the database itself rejects the insert. We treat this as a required backstop, not redundant caution.

### 3.3 Releasing a hold (expiry, cancellation, payment failure)

Hold release follows the same lock-then-check-then-write pattern: lock the `showtime_seats` row, verify `current_hold_id` still equals the hold being released (a newer hold may have already superseded it — nothing to do in that case), set status back to `AVAILABLE`, clear `current_hold_id`, stamp the `SeatHold` with its release reason. Publish `SEAT_RELEASED`.

**Payment-failure release rule:** if a card is declined, the hold is *not* immediately released — the customer gets a configurable grace window (default: remainder of the original hold TTL, not reset) to retry with a different payment method, since immediately releasing the seat on a simple decline would be a poor customer experience for a plausible mistake (wrong CVV, insufficient funds retried on a different card). If the hold's original `expiresAt` passes regardless of retry attempts, it releases unconditionally — the hold never gets extended past its original expiry by retries.

## 4. Hold expiry mechanism

Two layers, matching the "Redis for state/expiry, Postgres for correctness" split:

1. **Sweep job** (every ~15s, or triggered by Redis keyspace-notification on expiry): queries `seat_holds WHERE released_at IS NULL AND expires_at < now()`, and releases each via the same locked transaction as §3.3. This is the layer that guarantees release even if no client is watching.
2. **Lazy check on read/lock**: any transaction that locks a `showtime_seats` row (a new hold attempt, a purchase attempt) checks `expires_at` itself and treats an expired hold as if it were already released, rather than trusting the sweep job has run yet. This closes the gap between "TTL technically passed" and "sweep job hasn't executed yet," so a customer can never be blocked by a stale hold that's actually expired.

Countdown UI reads the hold's `expiresAt` directly (server-authoritative timestamp, not a client-side timer started from an assumed duration) so clock drift or a paused tab doesn't desync the displayed countdown from the real expiry.

## 5. Idempotency

- Seat-hold creation requests carry a client-generated `requestId`; the API stores the last N request ids per session briefly in Redis to make an accidental double-tap a no-op rather than two hold attempts.
- Purchase/payment confirmation is idempotent via `Payment.idempotencyKey` (derived from the `TicketOrder` id) — both at the Stripe API level (Stripe's own idempotency key) and at our DB level (unique constraint), so a retried checkout submit or a duplicate webhook cannot create two successful payments or two tickets for the same order.

## 6. Box office and online share one inventory

There is exactly one `ShowtimeSeat` table and one code path (`SeatingService`) for hold/purchase/release, called by both the customer-web checkout flow and the box-office POS flow. Box office "block seat" and "house seat" are additional terminal-ish statuses (`BLOCKED`, `HOUSE`) reachable only by staff with the relevant permission, going through the same locked-transaction pattern — not a parallel system that could drift from online availability.

## 7. Seat states

`AVAILABLE`, `HELD`, `SOLD`, `BLOCKED` (manager-blocked, e.g. broken seat), `HOUSE` (comped/staff-held for operational reasons), `ADA_RESERVED` / `COMPANION` (structural attributes on `Seat`, combined with the live status — an ADA seat can still be `AVAILABLE`/`HELD`/`SOLD` like any other; "ADA_RESERVED" as a *status* value is used when staff temporarily reserve it for an ADA request ahead of general sale, distinct from the seat's permanent `seatType = ADA`), `UNAVAILABLE` (seat inactive/removed from sale entirely, e.g. under repair).

## 8. Required automated concurrency tests (Milestone 2 completion gate)

- **N-simultaneous-hold test**: fire 20 concurrent hold requests for the same `ShowtimeSeat`; assert exactly 1 succeeds, 19 receive a clean "unavailable" response, and the DB has exactly one active `SeatHold` for that seat.
- **N-simultaneous-purchase test**: pre-create N valid holds held by N different sessions is not possible by definition (only one hold can be active), so this test instead races N purchase attempts against a *single* valid hold plus M attempts against seats each holder legitimately holds, confirming no cross-contamination and exactly one `Ticket` row per seat.
- **Hold-expires-during-payment-processing test**: create a hold with a very short TTL, begin the purchase transaction after expiry, assert the purchase is rejected with a clear "hold expired, seat released" error rather than silently succeeding against a stale hold.
- **Payment-declined-then-retry-within-window test**: decline, retry with new method before TTL, assert success and single ticket.
- **Double-webhook test**: send Stripe's webhook payload twice for the same event id, assert exactly one `Ticket`/`Payment.SUCCEEDED` results (this test lives here and in PAYMENT_FLOW.md's test list since it exercises both).

These tests run against a real Postgres instance (not mocked) in CI, using actual concurrent connections/promises, because the entire point is proving the row-locking behavior works under real concurrency, not asserting mocked application logic.
