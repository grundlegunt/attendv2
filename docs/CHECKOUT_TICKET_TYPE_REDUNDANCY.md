# Checkout — Redundant Ticket Type Selector on Single-Seat Orders

## The bug

Live-tested checkout for a single-seat order (Seat C5, one ticket). The "Ticket
types" panel shows **two** dropdowns, both defaulting to "Standard": the bulk
"Apply one type to all tickets" selector, and immediately below it, a per-seat
selector for that same single seat. They control the same thing for a one-seat
order — genuinely redundant, not just visually busy.

Confirmed in `apps/customer-web/app/components/ticket-checkout.tsx` (~line 765):
the per-seat breakdown (`seats.map(...)`) renders unconditionally, for every
order regardless of seat count. There's no check for `seats.length > 1` before
showing it.

## The fix

Only show the per-seat ticket-type breakdown when there's more than one seat in
the order. For a single-seat order, the bulk "Apply one type to all tickets"
selector alone is sufficient — it already sets the type for the only seat there
is. For multi-seat orders, keep both: the bulk selector as a convenient "set them
all the same" shortcut, and the per-seat rows for overriding individual tickets
(e.g., one Adult, one Child in the same order) — that part of the UI is doing real
work once there's more than one seat.

## Guardrails

- Don't remove the per-seat selector entirely — it's necessary for mixed-type
  orders, which is the actual feature `docs/` reporting confirmed exists
  (`TicketOrder.ticketTypeSelections`, mixed types per order). This is a
  single-seat-specific redundancy, not a reason to simplify away the per-seat
  capability.
- Verify the bulk selector's `onChange` still correctly seeds
  `ticketTypeByHoldToken` for the single seat even when its own row isn't
  rendered — it already does this today (line 756), just confirm nothing else
  reads the per-seat row's presence as a signal that a selection was made.
