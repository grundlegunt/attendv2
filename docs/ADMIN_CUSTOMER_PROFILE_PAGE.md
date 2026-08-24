# Admin — Customer Profile Page

## The ask

A per-customer view in Admin — visit history, last order, membership status —
similar in spirit to a CRM card (name, membership tier, recent activity).

## What already exists — this is a UI task, not a new system

Checked directly: the backend is already real and working.

- `GET /management/customers/:customerId` (`apps/api/src/management/management.controller.ts`)
  already returns a customer's name/email/phone, `isGuest` status, their
  membership (`membershipNumber`, `tier`, `status`, `expiresAt` — via the real
  `Membership` model), and paginated ticket-order and dining-tab history for the
  current location (`management.service.ts`'s `customer()` method).
- `GET /management/customers/:customerId/history.csv` already exports that
  history.
- `PATCH /management/customers/:customerId/membership` already lets staff update
  a customer's membership.

None of this is exposed anywhere in `apps/admin` — confirmed no customer detail
route exists in the app today. The data is real; there's just no page showing it.

## What to build

A customer detail page in Admin, reachable from wherever a customer is already
referenced (box-office sale lookup, refunds, gift card purchase records) —
consuming the existing `customer()` endpoint as-is:

- Identity: name, email, phone, guest vs. registered, member-since date
  (`createdAt`).
- Membership: tier, status, expiration if the customer has one.
- Order history: paginated ticket orders and dining tabs, reusing the pagination
  the endpoint already supports (`ticketOffset`/`diningOffset`).
- Link to the existing CSV export for anyone who wants the raw history offline.

## Guardrails

- No schema or API changes needed — reuse `customer()` and the CSV export
  exactly as they exist.
- Don't add loyalty points, favorite-genre inference, or rewards redemption as
  part of this — those are the separate, already-known "Loyalty & Subscriptions"
  gap (deferred elsewhere in this project), not part of showing what's already
  tracked today.
