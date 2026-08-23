# Post-MVP Backlog

Status: Living reference, reconciled August 23, 2026 — tracks real gaps and opportunities surfaced in `COMPETITIVE_LANDSCAPE.md`, `OPEN_QUESTIONS.md`, `PROGRAMMING_AND_SCHEDULING.md`, `TIMED_ENTRY_EXPANSION_PLAN.md`, and the documentation-only review PRs retired by this reconciliation. None of this is sequenced into `IMPLEMENTATION_PLAN.md`'s Milestones 0–11 on purpose: that list records the MVP foundation for the core customer (an independent dine-in cinema), and mixing it with open-ended expansion ideas would blur "done" with "someday." Promote an item into active work when a concrete business need, customer, or partner makes its requirements real.

## 1. Concrete product work still worth prioritizing

These items have a clear operator or customer benefit and can be scoped without inventing an outside business relationship.

- **Attend Master client-health signals.** Once multiple real clients are operating, add trend, refund-rate, and payment-failure indicators alongside revenue. Validate thresholds against real operating history rather than hardcoding speculative alerts.
- **Wallet passes and SMS.** Add Apple/Google wallet tickets and a transactional SMS provider for time-sensitive showtime, ticket, and food-ready notifications. Define consent, delivery fallback, and provider cost controls before implementation.
- **Analytics and consent.** Instrument the public funnel only after choosing an analytics policy and consent behavior. Keep essential ticketing storage independent from optional marketing consent.

## 2. Items needing a product decision or reproducible case

Do not implement these from a vague report alone.

- **Admin selected-showtime workspace.** Historical seat inventory, dashboard seat previews, and the complete daily schedule are implemented. The remaining request is a product-layout decision: whether the selected-showtime editor should become a compact right-side inspector with seat inventory in a separate modal. Validate the full scheduling workflow at the target laptop and tablet widths first.
- **Film-series click behavior.** Edit, archive, and restore actions exist. Capture the exact element clicked, expected destination, and observed behavior before changing row interaction or adding a detail route.
- **Checkout layout movement.** Existing reports did not identify a stable trigger. Record the browser, viewport, checkout step, and a screen capture before changing layout code; distinguish actual cumulative layout shift from normal loading and payment-element resizing.
- **In-person tipping surface.** Guest self-pay tipping exists. Identify the specific Staff POS or terminal settlement path where tip collection is missing before expanding the implementation.
- **Configurable fallback gratuity.** If the business wants an automatic gratuity when an abandoned seat-linked check is settled, define disclosure, eligible checks, exemptions, and the administrative rate setting first. Do not silently hardcode 20 percent.

## 3. Gated on a real decision or relationship first

Real, scoped work exists (or has been assessed), but building now would be guessing at requirements that only a real customer/partner can supply:

- **Comscore integration and contractual film settlement.** Internal distributor reporting can advance using verified deal-term shapes, but external reporting formats, settlement exports, and compliance should wait for a real distributor relationship and confirmed delivery requirements. `OPEN_QUESTIONS.md` §1.1a's deferral reasoning still applies to the external integration.
- **Multi-location consolidated (corporate) reporting**, without breaking per-location reporting — relevant once a customer actually operates more than one location under one Organization.

## 4. Adjacent-market expansion (nonprofit / general-admission venues)

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

- **Production observability** — unexpected API failures and root crashes across the customer site, Admin, Attend Master, Staff POS, and KDS produce vendor-neutral alerts with rate limiting, stable fingerprints, safe code frames, and recovery screens; exception messages, query strings, credentials, and customer/payment data are excluded.
- **Distributor and cinema revenue split reporting** — Revenue Overview calculates theatrical-week distributor and cinema shares from validated film terms, identifies unallocated revenue, and exports distributor box-office detail without treating settlement as a register-time payment split.
- **Ticket-fee drill-down** — Revenue Overview expands fee totals into order-level ticket counts, channel, average fee, and collected fee detail while preserving Attend's current fee treatment.
- **Admin global search** — managers can search orders, customer names and email addresses, tickets, and gift cards from one location-scoped entry point.
- **Consolidated attention inbox** — actionable box-office, refund, private-event, and payment exceptions are available together without mixing them into informational dashboard metrics.
- **Customer self-service in-seat ordering** — short-lived guest tab credentials allow customers to add published menu items and modifiers through the existing restaurant order and KDS pipeline, with idempotent creation, item, and send operations.
- **Schedule and pricing bulk actions** — managers can select multiple showtimes and update their ticket group or sale status together, with location scoping, optimistic concurrency checks, idempotent retries, and one auditable batch mutation.
- **Sold-out waitlists** — sold-out reserved-seat and general-admission showtimes offer rate-limited, idempotent email signup; entries expire at showtime, returned inventory is claimed safely across API instances, failed email delivery retries, and notifications explicitly avoid promising that tickets remain available.
- **Cinema programming and scheduling workspace** — the scheduling foundation is implemented in the cinema Admin app; `PROGRAMMING_AND_SCHEDULING.md` remains its product reference.
- **Public-site scope for `customer-web`** — resolved toward a broader theater website, with public navigation and content pages alongside the transactional ticket-buying flow.
- **Gift cards and vouchers** — implemented across admin issuance and ledger management, staff balance checks and redemption, cash/card/terminal split tenders, refunds, online checkout, customer balance lookup, and recipient email delivery with retry handling.
- **Digital signage** — implemented as a read-only lobby showtime display with a launcher in the location-management screen.
- **Private screenings, theater buyouts, and group/school sales** — implemented as a public inquiry flow with persisted requests, an admin work queue, status management, search/filtering, and CSV export. Custom contracts and pricing remain an operator follow-up rather than a retail checkout flow.
- **Single-seat checkout ticket-type redundancy** — resolved while preserving mixed ticket types for multi-seat orders.
- **Showtimes card layout and image treatment** — the customer grid remains three cards per row, with the taller 5:3 artwork treatment and consistent showtime alignment.
- **Showtimes hover and inline trailers** — cards expose hover details, supported YouTube URLs open in an accessible inline modal, and unsupported URLs retain a safe new-tab fallback.
- **Tax and pricing input safety** — tax rates use customer-facing percentages, implausible values are rejected, multi-category creation is supported, and existing rules can be edited without rewriting historical transactions.
- **Attend Master auditorium validation** — the builder enforces valid layout minimums and platform API errors surface structured validation issues.
- **Published menu presentation** — the customer Dining & Bar page renders the published image or PDF while keeping the structured menu available as accessible text.
- **Admin operational links** — authenticated Admin navigation links to the deployed Staff POS and KDS applications when the employee has access.
- **Admin dashboard correctness** — historical seat previews, serialized preview requests, cinema-local reporting ranges, and the complete daily schedule are implemented.
- **Searchable Attend Master audit log** — filters cover actor, action, organization, and date range.
- **Customer account recovery and site discovery** — password reset, social metadata, robots, sitemap, and an install manifest are implemented.

## Superseded documentation PRs

This reconciliation replaces the stale snapshots in PRs #550, #598, #602, #628, #629, #630, #631, #633, #635, #636, and #644. Those PRs should be closed rather than merged unchanged: each captured useful feedback at the time, but several now describe completed work as missing. Any still-valid requirement from them is retained above.

## Also tracked elsewhere, not duplicated here

- **Timed-entry event support** (session-level capacity, recurring sessions, flexible ticket categories for non-cinema venues) — full plan in `TIMED_ENTRY_EXPANSION_PLAN.md`.
