# Post-MVP Backlog

Status: Living reference — tracks real gaps and opportunities surfaced in `COMPETITIVE_LANDSCAPE.md`, `OPEN_QUESTIONS.md`, `PROGRAMMING_AND_SCHEDULING.md`, and `TIMED_ENTRY_EXPANSION_PLAN.md`. None of this is sequenced into `IMPLEMENTATION_PLAN.md`'s Milestones 0–11 on purpose: that list records the MVP foundation for the core customer (an independent dine-in cinema), and mixing it with open-ended expansion ideas would blur "done" with "someday." Promote an item into active work when a concrete business need, customer, or partner makes its requirements real.

## 1. Gated on a real decision or relationship first

Real, scoped work exists (or has been assessed), but building now would be guessing at requirements that only a real customer/partner can supply:

- **Distributor box-office reporting, Comscore integration, and film-rental/settlement calculations.** Full pre-implementation assessment already produced (architecture, schema, phasing, Comscore integration unknowns) — see the session record for the complete writeup. `OPEN_QUESTIONS.md` §1.1a's original deferral reasoning still applies until a real distributor relationship and its actual contract terms exist. Revisit when: a theater on the platform has a real booking relationship, and it's confirmed whether Comscore reporting is actually required to book the titles in question.
- **Multi-location consolidated (corporate) reporting**, without breaking per-location reporting — relevant once a customer actually operates more than one location under one Organization.

## 2. Adjacent-market expansion (nonprofit / general-admission venues)

Surfaced by testing the plan against a real nonprofit arthouse (Belcourt Theatre, Nashville) as a stand-in for a whole class of venue the platform doesn't currently fit: nonprofit, general-admission, membership/donation-funded rather than dine-in-driven. None of this matters for the core dine-in customer (Meridian and similar); it only matters if/when pursuing this adjacent segment deliberately.

- **General-admission ticketing mode — the structural item.** No seat map; a `Showtime`/`Auditorium` `seatingMode` of `RESERVED` or `GENERAL_ADMISSION` selling against a capacity count instead of individual seats, with the same concurrency discipline as seat holds (locked capacity decrement instead of per-seat lock). Worth building on its own merits eventually — most small/older/community cinemas and nearly all film festivals run general admission, not reserved seating — but it's a real expansion of the addressable market, not a one-off accommodation for one theater.
- **Real membership/giving-tier program with correct tax mechanics.** A paid membership with benefits is legally a charitable contribution with quid pro quo — the fair market value of benefits received must be disclosed, and only the excess is tax-deductible. Needs a real `MembershipTier`/`MembershipGift` concept, `Payment.purpose` gaining `DONATION`/`MEMBERSHIP_GIFT`, and receipts that state the deductible amount correctly.
- **A standalone donate flow** — one-time and recurring giving with nothing purchased in return; every payment today originates from a ticket or a tab.
- **Nonprofit-specific reporting** — donor/membership reports and program-level attendance, extending Milestone 10's reporting scope rather than a new subsystem.
- **Season passes / packages** — buy once, redeem across many future showtimes (a flex pass, a festival package, a subscription series). Nothing in the current `TicketOrder`/`Ticket` model supports this; every ticket sells against one specific showtime at purchase time.
- **Loyalty points**, as a mechanic distinct from paid membership tiers (earn-and-redeem vs. pay-for-a-tier).
- **Real fundraising campaign management** — multiple campaigns against targets, pledges, grant/restricted-fund compliance deadlines. Different from just recording a donation correctly.
- **Segmented marketing/communications** — campaigns to "everyone who donated last year" or "members who haven't renewed," distinct from the transactional receipts/alerts the current `Notification` entity handles.
- **General merchandise/retail sales** (books, posters, branded items) — would likely reuse most of the existing menu-item/counter-sale machinery rather than needing something new.
- **A richer CRM view** — one person's full history (tickets, donations, memberships, communications) in one place, household/family links, custom fields. Mostly a missing query/screen layer over data that already exists across the schema, not missing data.
- **Real cross-venue member recognition** (e.g., reciprocal benefits across theaters, like the Art House Convergence network) — noted as a genuinely interesting long-term differentiator if enough independent theaters end up on the platform, but doesn't fit today's per-tenant isolated design and isn't worth building for a first customer.

## Resolved since this backlog was drafted

- **Cinema programming and scheduling workspace** — the scheduling foundation is implemented in the cinema Admin app; `PROGRAMMING_AND_SCHEDULING.md` remains its product reference.
- **Public-site scope for `customer-web`** — resolved toward a broader theater website, with public navigation and content pages alongside the transactional ticket-buying flow.
- **Gift cards and vouchers** — implemented across admin issuance and ledger management, staff balance checks and redemption, cash/card/terminal split tenders, refunds, online checkout, customer balance lookup, and recipient email delivery with retry handling.
- **Digital signage** — implemented as a read-only lobby showtime display with a launcher in the location-management screen.
- **Private screenings, theater buyouts, and group/school sales** — implemented as a public inquiry flow with persisted requests, an admin work queue, status management, search/filtering, and CSV export. Custom contracts and pricing remain an operator follow-up rather than a retail checkout flow.

## Also tracked elsewhere, not duplicated here

- **Timed-entry event support** (session-level capacity, recurring sessions, flexible ticket categories for non-cinema venues) — full plan in `TIMED_ENTRY_EXPANSION_PLAN.md`.
