# Post-MVP Backlog

Status: Reference — tracks real gaps and opportunities surfaced in `COMPETITIVE_LANDSCAPE.md`, `OPEN_QUESTIONS.md`, `PROGRAMMING_AND_SCHEDULING.md`, and `TIMED_ENTRY_EXPANSION_PLAN.md`. None of this is sequenced into `IMPLEMENTATION_PLAN.md`'s Milestones 0–11 on purpose: that list is the MVP roadmap for the core customer (an independent dine-in cinema), and mixing it with open-ended expansion ideas would blur "done" with "someday." Revisit this list once Milestone 11 is complete or a specific business need (a real second customer, a real distributor relationship) makes an item concrete.

## 1. Ready to build whenever there's room

Low ambiguity, no open business decision blocking them, relevant to the core dine-in customer as-is:

- **Gift cards and vouchers** — low-complexity, high-margin, seasonal revenue line; a lot of gift card balances are never fully redeemed. Explicitly out of scope for MVP (`PRODUCT_SPEC.md` §6).
- **Digital signage** — a read-only lobby/marquee display of showtimes. Comparatively easy since the data already lives in the API; no new architecture needed.
- **Private screenings, theater buyouts, and group/school sales** — a real, commonly offered revenue line (whole-auditorium rental for a birthday, corporate event, school trip), usually with custom pricing and a different booking flow than per-seat retail sale. Not represented anywhere in the current schema.

## 2. Gated on a real decision or relationship first

Real, scoped work exists (or has been assessed), but building now would be guessing at requirements that only a real customer/partner can supply:

- **Distributor box-office reporting, Comscore integration, and film-rental/settlement calculations.** Full pre-implementation assessment already produced (architecture, schema, phasing, Comscore integration unknowns) — see the session record for the complete writeup. `OPEN_QUESTIONS.md` §1.1a's original deferral reasoning still applies until a real distributor relationship and its actual contract terms exist. Revisit when: a theater on the platform has a real booking relationship, and it's confirmed whether Comscore reporting is actually required to book the titles in question.
- **Whether `customer-web` needs to be a theater's entire public website** (homepage, about, hours, news/blog — like Veezi and Filmbot both build) or just the transactional buy-flow embedded in a site the theater already has. A real decision, not an engineering question.
- **Multi-location consolidated (corporate) reporting**, without breaking per-location reporting — relevant once a customer actually operates more than one location under one Organization.

## 3. Adjacent-market expansion (nonprofit / general-admission venues)

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

## Also tracked elsewhere, not duplicated here

- **Cinema programming & scheduling workspace** — full plan in `PROGRAMMING_AND_SCHEDULING.md`.
- **Timed-entry event support** (session-level capacity, recurring sessions, flexible ticket categories for non-cinema venues) — full plan in `TIMED_ENTRY_EXPANSION_PLAN.md`.
