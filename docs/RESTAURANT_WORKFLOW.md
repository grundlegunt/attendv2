# Restaurant Workflow

Status: Draft v1
Related: STATE_MACHINES.md, DATA_MODEL.md, PAYMENT_FLOW.md

## 1. Tab lifecycle relative to the seat

A `RestaurantTab` is not automatically created at ticket purchase. It is created the moment it's needed — either because the customer authorized dining payment at checkout (tab starts `PREAUTHORIZED`) or because a server opens it in the POS when they approach the seat (`NOT_OPEN → OPEN`). This avoids creating tab rows for the (likely common) case of customers who don't order anything.

## 2. One seat, one tab by default; combining and splitting

Default: each seat gets its own `RestaurantTab` when first ordered against, via its own `RestaurantTabSeat`. When a customer buys multiple seats in one `TicketOrder` (e.g., John buys C4–C7), checkout offers a choice: one shared tab for the group, or individual tabs per seat. This preference is stored and used to pre-create the `RestaurantTabSeat` grouping when the server first opens any seat in that order — but it is not locked in permanently:

- **Splitting**: a server or manager can move a `RestaurantTabSeat` out of a shared tab into its own new tab. Items already ordered against that seat move with it (`RestaurantOrder.showtimeSeatId` is preserved, so the split is a reassignment of tab ownership, not a rewrite of order history).
- **Combining**: two open tabs for seats in the same showtime can be merged by staff (manager or the assigned server) into one tab; this reassigns `RestaurantTabSeat` rows onto the surviving tab and closes the other as `VOIDED` with a reference to the tab it merged into (audit trail preserved, not deleted).
- **Moving individual items**: an item can be moved between two open tabs for the same showtime (e.g., "actually the fries were for C5, not C4") — recorded as a transfer with before/after tab references on the `RestaurantOrderItem`, audited, permission-gated (`restaurant.order.transfer`).

## 3. Server POS flow

1. Server selects auditorium + showtime (their assigned section, filtered by default).
2. Graphical seat grid renders with visual states derived from `ShowtimeSeat.status` + associated `RestaurantTab.status` + `FulfillmentTicket` statuses in that seat's active orders: **Empty** (no ticket sold), **Occupied** (ticket sold, no tab activity), **Tab Open** (open tab, no outstanding kitchen/bar items), **Needs Attention** (an item is `READY` and not yet `DELIVERED`, or customer flagged something), **Payment Needed** (`PAYMENT_FAILED`/`MANAGER_REVIEW`), **Closed** (tab settled).
3. Server taps a seat → detail view: movie/showtime/auditorium/row/seat, customer name (if available), payment-on-file indicator (safe display only — "Visa •••• 4242" from `PaymentMethodReference`, never more), current tab itemization with running subtotal, and actions `ADD ITEM`, `SEND`, `SPLIT`, `TRANSFER`, `CLOSE CHECK`.
4. `ADD ITEM` opens the menu (categories → items → required/optional modifiers per `ModifierGroup`), builds up a `DRAFT` `RestaurantOrder`.
5. `SEND` commits the draft: creates `RestaurantOrderItem` rows, groups them by resolved `kitchenStationId` into one or more `FulfillmentTicket`s, sets `RestaurantOrder.status = SENT`, publishes to the relevant `station:{kitchen|bar|...}` room. This is the point of no casual return — canceling after send requires a void action, not just deleting a draft line.

## 4. Order routing

Routing is resolved per item at send time from `MenuItem.kitchenStationId` (e.g., Cheeseburger/Fries → Kitchen, Old Fashioned/Beer → Bar, Popcorn → Concessions), not hardcoded by category name, so operators can reassign routing per item without code changes. Each `FulfillmentTicket` carries only the items for its station — the kitchen never sees the Old Fashioned, matching the spec's example precisely. `RestaurantOrderItem` retains seat, auditorium, showtime, server, allergy notes, and course at write time (denormalized snapshot) so a station display never needs to join across five tables to render a ticket.

## 5. Kitchen Display System (KDS)

Per-station queue view (`kds` app filtered to `KITCHEN`), grouped by `FulfillmentTicket`, showing auditorium, seat, server name, item(s) with modifiers/allergy notes, and time ordered. Actions: `START` (`NEW → ACCEPTED`/`PREPARING`), `READY` (`→ READY`). Designed for several-feet legibility: large type, high contrast, color-coded age (a ticket sitting past a configurable SLA visibly changes color/urgency). Real-time via the `station:kitchen:{locationId}` room; a reconnect always re-fetches the current queue rather than trusting buffered events, so a tablet that drops Wi-Fi mid-service catches up correctly instead of showing a stale queue.

## 6. Bar Display System (BDS)

Same component, filtered to `KITCHEN_STATION = BAR`, same actions and states. Not a separate codebase — a station parameter on the same `kds` app and API queries.

## 7. Customer live tab

Accessible via the digital ticket / QR / account (a signed, expiring link is issued alongside the QR ticket so guest customers without accounts can still reach their tab securely without a password). Shows itemized current tab (live-updating via the `tab:{id}` room as the server sends/updates orders), tip selection (18/20/22%/custom, computed off the *pre-tax, pre-service-charge* subtotal by default — configurable per location, documented assumption in OPEN_QUESTIONS.md), total, and whether the tab will auto-close (surfaced directly from `RestaurantTab.autoSettleAuthorized` / `autoSettleAt`) so the customer is never surprised by an automatic charge they didn't expect. `PAY & CLOSE TAB` triggers the manual settlement path in PAYMENT_FLOW.md §4.

## 8. Edge cases and defined behavior

- **Customer changes seats after ordering food.** If a manager/box-office moves a ticket to a new seat (same showtime), the associated open `RestaurantTabSeat` moves with it — the tab follows the ticket, not the physical seat number, because the tab's purpose is billing the person, not the chair. The server POS view for the *old* seat shows it reverted to its prior sold-but-no-tab state; the new seat shows the existing tab.
- **Server adds food to the wrong seat.** Corrected via the item-transfer action (§2) between two open tabs for the same showtime; if the wrong seat has no tab yet, a manager can void the item on the wrong tab and it's re-added fresh on the correct one (simplest correct state, avoids inventing a "retroactive seat reassignment" concept for a single mistaken item).
- **Manager transfers an order.** Same mechanism as item transfer, applied at the order level; requires `restaurant.order.transfer` permission, audited.
- **Customer leaves before closing tab.** If pre-authorized, the automatic settlement job handles it at the configured trigger (PAYMENT_FLOW.md §6). If not pre-authorized, the tab surfaces in a staff "unsettled tabs" view after the showtime ends, requiring manual resolution (charge a method captured at the table via card reader/box office, or write off with manager approval — a `MANAGER_REVIEW`-adjacent operational flow).
- **Stored payment fails at settlement.** Tab → `PAYMENT_FAILED`, no blind retry, staff alerted, customer notified with a link to supply a new method (all per PAYMENT_FLOW.md §6).
- **Customer disputes an order item.** Recorded as a manager-initiated void or comp against the specific `RestaurantOrderItem` with a reason code and audit event; does not require reopening a closed tab if the dispute is post-payment — a partial refund against the `Payment` is issued instead, scoped `RESTAURANT`.
- **Customer wants to use a different card mid-tab.** Adding a new `PaymentMethodReference` via a fresh `SetupIntent` is always available from the live tab or via staff; the tab's active payment method for settlement is whichever the customer most recently designated, tracked with a timestamp (not silently the "first" one).
- **Part cash, part card.** Modeled as two `Payment` rows against the same tab (PAYMENT_FLOW.md §4); tab closes when the sum covers the total.
- **Menu item 86'd while server is mid-order.** `MenuItem.is86d = true` is checked both at add-to-draft time (client-side UX, blocks selection) and again server-side at `SEND` (authoritative) — if it was 86'd in the gap, `SEND` rejects that line item specifically with a clear error, not the whole order, and the server is prompted to remove/substitute it. The `MENU_ITEM_86D` real-time event also actively updates any POS device with that item already open in a draft, greying it out live.
- **Refire needed.** Server or kitchen initiates `DELIVERED → REFIRE` on the specific `FulfillmentTicket` (STATE_MACHINES.md §7); does not affect the customer's bill by default (a refire is a kitchen-quality issue, not automatically a new charge) unless a manager explicitly adds a new billable item.
- **Refund includes ticket but not food, or food but not ticket.** Directly supported by `Refund.scope` (PAYMENT_FLOW.md §7) — the two payments are always independent rows against independent purposes.
- **Theater needs to evacuate/cancel a screening.** A `Showtime.status = CANCELED` action (manager-only) triggers: all associated tickets → `CANCELED` with automatic full refund initiation, and all open `RestaurantTab`s for that showtime are automatically **comped** — a defined default policy, not a per-incident staff judgment call. Any items already delivered are written off rather than billed; if the tab had already been charged (e.g., a customer paid mid-movie before the cancellation), a matching `RESTAURANT`-scoped refund is issued automatically. An `AuditEvent` records the cancellation reason and initiating manager, plus one for each resulting comp/refund.

## 9. What the server never sees

No PAN, no CVV, no raw processor tokens beyond the display-safe brand/last4 the `PaymentProvider` interface exposes. "Payment on file ✓" plus a brand/last4 string is the ceiling of what the POS UI renders, matching the spec's explicit requirement and reinforced in SECURITY.md's role permission matrix.
