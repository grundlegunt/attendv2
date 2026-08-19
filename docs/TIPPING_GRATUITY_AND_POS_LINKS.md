# Tipping at Checkout, Default Gratuity on Unclosed Checks, Admin → POS Links

## Tipping — mostly already exists, needs a check on where

Checked `apps/api/src/restaurant/restaurant-settlement.service.ts` — real,
working tip infrastructure already exists: `selectTip`/`selectGuestTip`,
`tipCents`, including a guest-facing self-pay flow (token-based link) where a
customer can pick their own tip. This isn't a missing feature in general.

If tipping is missing somewhere specific — the box-office/staff terminal card-reader
flow when a staff member settles a check in person, for instance — that's a
narrower, real gap worth confirming precisely (which screen, which flow) rather
than treating "we need tipping" as if nothing exists. Don't rebuild the tip
system; find and fix the specific surface that's missing it.

## Default 20% gratuity on checks that don't get closed out

This maps directly onto infrastructure that already exists, rather than needing a
new system. Two existing pieces:

- `ServiceChargeRule` (with `autoApply`) — already applies configured charges
  automatically to qualifying orders.
- `RestaurantSettlementSchedulerService` (`apps/api/src/restaurant/restaurant-settlement-scheduler.service.ts`)
  — already runs a durable fallback sweep for seat-linked tabs whose check was
  never dropped/closed.

**The natural fix**: when the existing fallback scheduler settles an abandoned
check, apply a default gratuity (20%, admin-configurable rather than hardcoded)
if no explicit tip was ever selected — rather than building a separate gratuity
system. This reuses the exact mechanism that already exists for "this check never
got properly closed."

## Admin needs links to Staff POS and Kitchen (KDS)

Confirmed: Admin's sidebar has a "View customer site ↗" link
(`apps/admin/app/admin-nav.tsx`) but nothing pointing to Staff POS or KDS. Add the
same pattern for both, matching `docs/ADMIN_NAVIGATION_RESTRUCTURE.md`'s "POS"
item under F&B. This depends on Staff POS and KDS actually having stable deployed
URLs first (`docs/STAFF_POS_DEPLOYMENT_AND_LAYOUT.md`) — there's nothing to link
to yet if that deployment work hasn't happened.

## Guardrails

- Confirm exactly where tipping is missing before building anything — the
  underlying capability is real and working elsewhere.
- The gratuity default should be admin-configurable (a rate, not a hardcoded 20%
  in code), even though 20% is the number asked for right now.
- The POS/KDS nav links are blocked on deployment, not on anything else — don't
  build them pointing at `localhost` URLs that won't work for real staff.
