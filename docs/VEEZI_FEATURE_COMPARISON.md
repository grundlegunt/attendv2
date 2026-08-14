# Attend vs. Veezi — Feature Comparison

Veezi (veezi.com) is a real, shipping cinema management SaaS competitor aimed at
independent cinemas — the same market Attend is targeting. Checked their public
feature list and dashboard documentation (help.veezi.com) against what's actually
built in Attend, confirmed against code, not assumed from either product's marketing.

## Attend already covers

- **Point of Sale** — box office + restaurant ordering (`apps/staff-pos/app/restaurant-pos.tsx`,
  831 lines: menu categories/items/modifiers, tab management, order sending to
  `apps/kds`), split tender, gift cards. Currently under very active correctness
  hardening (order-send locking, tab split/combine/settlement race protection).
- **Film Programming** — the scheduling calendar.
- **Cinema Management** — dashboard/reporting exists (see gaps below for specifics).
- **V-Tix Internet Ticketing** — customer-web online checkout.
- **Web** — customer-web is a full public cinema website, arguably more custom than
  Veezi's template offering given the Nitehawk-modeled design work already done.
- **UsherPoint** (ticket scanning) — Attend's scanner (manual QR entry + camera
  scanning, duplicate-scan prevention) does the same job, built into staff tools
  rather than a separate consumer app.
- **Vouchers & Gift Cards** — full issuance, balance, ledger, redemption, split
  tender support.
- **Digital Signage** — the lobby display feature (`apps/customer-web/app/signage`).
- **Time & Attendance** — staff clock-in/out and break controls, recently made
  idempotent against double-submission.
- **Veezi Payments** — functionally covered by Stripe Connect; not Attend's own
  branded payments product, but does the same job.

## Real gaps — Veezi has these, Attend doesn't

- **Movie Mailer** (automated weekly showtime emails with direct ticket links).
  Same gap as `docs/PROMOTIONS_AND_CAMPAIGNS.md` Phase 3 — blocked on choosing a
  bulk-email provider and a marketing-consent model, a decision that still hasn't
  been made. Worth revisiting now that a direct competitor ships this.
- **Loyalty & Subscriptions.** Matches Codex's own "longer-term, deferred until a
  real customer" list (membership mechanics). Confirmed still not built.
- **Inventory** (stock levels, vendor management, stocktake for concessions).
  Attend can mark a menu item unavailable ("86 it") but has no quantity tracking or
  vendor management at all. Not previously discussed anywhere in this repo's docs —
  a genuinely new gap.
- **Kiosk** (self-service ticketing/concessions terminal). Nothing like this exists
  in Attend. Never came up in prior planning.
- **Offline POS.** Veezi explicitly markets that box office/concessions "can even
  work offline if the internet goes down." Attend has no offline mode anywhere in
  `apps/staff-pos`. Directly relevant if venue wifi reliability is a real concern —
  see the "website vs. app" discussion elsewhere; a PWA with a service worker is
  the way to get this without going native.

## Reporting — specific, narrow gaps

Checked directly against `apps/api/src/reporting/reporting.service.ts`, which has
exactly three methods: `customerRecency`, `revenue`, `labor`. Compared against
Veezi's documented dashboard gadgets:

- **No per-operator / per-POS-session sales breakdown** (Veezi's "POS Operators"
  gadget — gross sales per cashier session, box office + concessions). Nothing in
  `revenue()` groups by employee or cash-drawer session.
- **No top-selling concession items ranking** (Veezi's "Top Sellers" — sortable by
  units sold, value, margin). `revenue()` breaks totals down by movie and by
  showtime, never by menu item.
- **No spend-per-patron trend over time** (Veezi's "Spend Per Patron" — this week
  vs. last week, with trend lines). Nothing computes a per-patron figure over time.
- **Partially covered**: Veezi's "Daily Statistics" gadget (admits, average spend
  per head, average ticket price, concession attach rate) overlaps with what
  `revenue()` already computes (`averageFnbSpendPerOrderCents`,
  `averageFnbSpendPerSeatCents`), but those are F&B-only, not a combined
  ticket+concession per-patron figure, and there's no attach-rate metric (% of
  transactions that included a concession sale).
- **Already covered**: Veezi's "Sales by Screen" (seats sold/remaining per session)
  — Codex just shipped the equivalent (seat inventory shown in scheduling).

This reporting gap is small and well-defined relative to Inventory/Kiosk/Movie
Mailer — it's additional aggregation on data Attend already has, not a new domain.

## Guardrails

- This is a comparison, not a build order. Triage against actual client needs
  before picking any of these up — Inventory and Kiosk in particular are real,
  multi-week features, not quick additions.
- The reporting gaps (per-operator, top-sellers, spend-per-patron trend) are the
  cheapest, most contained items here since they're pure aggregation over existing
  `TicketOrder`/`RestaurantTab`/`Employee` data — no new capture required.
- Movie Mailer and Loyalty are not new information — they're the same gaps already
  flagged in `docs/PROMOTIONS_AND_CAMPAIGNS.md` and Codex's own status report,
  cross-confirmed here against a real competitor actually shipping them.
