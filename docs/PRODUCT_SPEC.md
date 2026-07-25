# Product Specification — Dine-In Cinema Platform

Status: Draft v1 (architecture phase, pre-implementation)
Owner: Engineering
Related docs: ARCHITECTURE.md, DATA_MODEL.md, STATE_MACHINES.md, SEAT_RESERVATION_DESIGN.md, PAYMENT_FLOW.md, RESTAURANT_WORKFLOW.md, SECURITY.md, IMPLEMENTATION_PLAN.md, OPEN_QUESTIONS.md

## 1. Vision

Build a single platform that runs an independent dine-in movie theater end to end: reserved-seat ticketing (online and box office) and restaurant point-of-sale, unified by one rule — **every food and drink order is tied to a seat, and every seat is tied to a showtime, a ticket, and a customer.** The customer's tab follows them from the moment they buy a ticket to the moment they tip and pay, without re-identifying themselves to a server.

This is being built as the foundation of a real product, not a prototype. It must eventually run a live, multi-screen, paying business. That means correctness on money and seat inventory is non-negotiable, even though the UI and feature surface will grow incrementally.

## 1.1 Business Model & Tenancy

This is being built as a real, sellable multi-tenant SaaS product, not an internal tool for one theater — confirmed by the product owner. The strategy: undercut expensive incumbents (Vista, and to a lesser extent Filmbot) on price for small independent theaters, made possible because this is built with AI-assisted development rather than a funded engineering team, giving it a structurally lower cost basis than competitors. Revenue from theater customers is intended to help fund the founder's own separate cinema venture.

Consequences of this for the architecture:

- **The founder's own theater is Organization/tenant #1**, onboarded the same way any other customer theater would be — because it *is* a separate legal relationship (a software company serving a theater company), not an internal deployment with special-cased shortcuts. Nothing in the system should assume "the first organization" gets different treatment than the hundredth.
- **Multi-tenancy is a day-one concern, not a deferred phase.** This reverses an earlier, more cautious sequencing note in this document set — building for one theater first and generalizing later was the original plan, but since tenant #1 is itself a paying-relationship customer of the platform, the tenant-isolation and per-tenant payment routing described below need to exist from the start.
- **Payments must route per-tenant.** Each Organization's ticket and food/beverage revenue needs to reach *that theater's own bank account*, not a single platform-operator account — see PAYMENT_FLOW.md's new "Multi-tenant payment routing" section for how this is handled (Stripe Connect or equivalent), and DATA_MODEL.md for the resulting schema field.
- **Feature tiering is deliberately not part of the initial plan.** The pricing edge is meant to come from being cheap and easy to adopt as one complete product, not from restricting features into paid tiers — see OPEN_QUESTIONS.md for the full reasoning and what would change this.

## 2. Core Domain Concepts (shared vocabulary)

These concepts are shared between ticketing and restaurant operations. Both subsystems are views over the same data, not two systems that sync with each other.

- **Organization** — the company operating one or more theaters. **This is the tenant boundary, and the platform is multi-tenant from day one, not a deferred phase.** The founder's own theater is Organization/tenant #1, onboarded through the exact same path any other theater customer would use — it is not special-cased. See §1.1 below.
- **Location** — a physical theater property.
- **Auditorium** — a screen/room within a location, with a seat map.
- **SeatMap / Seat** — the physical seating layout and each seat's static attributes.
- **Movie / Showtime** — what's playing and when, in which auditorium.
- **ShowtimeSeat** — the per-showtime instance of a seat (this is where availability state lives).
- **SeatHold** — a temporary claim on a ShowtimeSeat during checkout.
- **Customer** — a person with or without an account (guest checkout supported).
- **TicketOrder / Ticket** — a purchase transaction and the individual admission credentials it produced.
- **RestaurantTab / RestaurantTabSeat** — the running bill associated with one or more seats for a showtime. A tab doesn't have to be seat-linked: a standalone bar can run walk-in tabs for guests with no ticket at all, or ticket holders visiting before/after their showtime (RESTAURANT_WORKFLOW.md §10).
- **RestaurantOrder / RestaurantOrderItem** — food/drink orders placed against a tab, routed to a station.
- **Payment** — a financial transaction against either a ticket order or a restaurant tab.
- **Employee / Role / Permission** — staff identity and what they're allowed to do, enforced server-side.
- **AuditEvent** — an immutable record of a sensitive or financial action.

## 3. Primary Personas

- **Guest customer** — browses movies, buys tickets, optionally orders/pays from their seat, no account required.
- **Registered customer** — same, plus saved payment methods, order history, faster checkout.
- **Box office employee** — sells/holds/blocks seats, handles cash and card, refunds, exchanges, comps, scans tickets.
- **Server** — works a section of auditoriums, takes food/drink orders against seats, manages tabs, closes checks.
- **Bartender** — same POS surface as server, scoped to bar station and bar-routed items.
- **Kitchen / Runner** — works the KDS, updates prep status, does not see payment data.
- **Door/usher** — scans tickets for admission.
- **Restaurant manager** — owns menu, stations, pricing of F&B, voids, comps within limits.
- **Cinema manager** — owns movies, showtimes, seat maps, ticket pricing, refunds.
- **General manager / Owner** — full operational and financial visibility, permission management.
- **Accounting** — financial reporting and reconciliation, no operational overrides.

## 4. End-to-End Customer Journey (target experience)

Movie → Showtime → interactive seat map → seat selection (held, countdown shown) → checkout (tickets + fees + tax) → optional dining payment authorization (explicit opt-in, never silent) → payment → seat marked SOLD → QR ticket issued (confirmation page + email) → customer arrives, is seated → server identifies the seat in the POS and sees "payment on file" → orders are placed against the seat → kitchen/bar receive routed items in real time → items marked ready/delivered → customer views live running tab on their phone → server drops the check as the movie nears its end → customer may order once more → customer selects tip and pays, split across whatever cards the table needs (or the fallback settlement catches it automatically if the check was never dropped) → tab closes → receipt issued → reporting and audit trail updated.

## 5. MVP Scope

In scope for the first shippable version (see IMPLEMENTATION_PLAN.md for milestone breakdown):

- One location, three auditoriums, structured (non-drag-and-drop) seat map configuration.
- Movies, showtimes, reserved seating, concurrency-safe holds.
- Online ticket purchase with convenience fee and tax; guest checkout and basic accounts.
- Box office sales sharing the same seat inventory as online sales.
- QR ticket issuance and scanning with re-use/wrong-showtime/refunded detection.
- Seat-linked restaurant tabs, one tab per seat by default with support for combining seats into one tab at checkout or by staff.
- Walk-in/bar tabs with no seat or showtime attached, for a standalone bar serving pre/post-movie guests and people off the street — same menu, kitchen/bar routing, and payment/tipping flow as seat-linked tabs, settled manually at the bar rather than auto-settled (RESTAURANT_WORKFLOW.md §10).
- Order-ahead concession pickup for theaters without a server floor — pre-order tied to the ticket, paid immediately, picked up at the counter instead of delivered to the seat (RESTAURANT_WORKFLOW.md §9.1). A theater can offer reserved-seat ticketing plus this alone, with none of the rest of the restaurant subsystem active — dine-in is not a requirement to get real value from the platform.
- Server tablet POS: seat-scoped ordering, send, split, transfer, close.
- Menu management with categories, modifiers, 86'ing, kitchen destination.
- Kitchen display and bar display with real-time status.
- Stripe-backed saved payment methods, dining authorization consent, tipping, manual and automatic settlement.
- Refunds (ticket and restaurant, independently).
- Manager dashboard: core config entities, refunds/comps, basic reporting, audit log viewer. Reporting explicitly includes: total revenue (ticketing + F&B, combined and split) over a chosen date range; revenue and tickets sold per movie, aggregated across all its showtimes; revenue and tickets sold per individual showtime; F&B revenue per movie and per showtime; and average F&B spend per seat/order. This is a query layer over data the schema already links end to end (DATA_MODEL.md §5's seat-to-tab chain), not a new tracking mechanism — see IMPLEMENTATION_PLAN.md Milestone 10.
- RBAC enforced server-side across all the roles listed above.
- Native staff time clock: PIN-based clock in/out and break tracking at the POS terminal, plus a labor/hours report and CSV export — matching the pattern used by Vista and Toast, where time clock is built into the core platform (see DATA_MODEL.md §1, IMPLEMENTATION_PLAN.md Milestones 9–10). Fully optional per theater (`Location.timeClockEnabled`) — a theater already using a dedicated scheduling tool (7shifts, Homebase, etc.) can switch it off and the clock-in screen and labor report disappear entirely, not just go unused.

## 6. Explicitly Out of Scope for MVP

- Native iOS/Android apps (responsive web only; APIs designed so native clients can be added later).
- Full Apple Wallet / Google Wallet pass issuance (architected for, not built).
- Graphical drag-and-drop auditorium designer (structured JSON/config-based layout authoring instead).
- Multi-location support beyond data-model readiness (single location operates in MVP).
- Gift cards, memberships beyond a lookup stub, promotions engine beyond a simple discount code.
- Split cash/card tender on a single restaurant payment (recorded as two payments against one tab instead — see OPEN_QUESTIONS.md).
- Real payment processing (Stripe test mode only throughout development).
- Payroll processing (tax withholding, filing, direct deposit). Hours are captured natively and exportable/integrable with a dedicated payroll provider — this mirrors how Vista and Toast keep payroll calculation out of their own core products (see OPEN_QUESTIONS.md).

## 7. Success Criteria for the First Vertical Slice

Defined in full in IMPLEMENTATION_PLAN.md ("Milestone 5/6/7 integration slice"), but at a glance: an admin can stand up one auditorium/movie/showtime, a customer can buy seat C4 and optionally authorize dining payment, a server can open C4's tab and send a burger to the kitchen and a cocktail to the bar, kitchen/bar can mark items ready, the customer can view their live tab, tip, and pay, and the tab closes with a receipt and audit trail. Nothing else is prioritized until this works reliably under test, including a concurrency test proving two simultaneous buyers cannot both win seat C4.

## 8. Visual Design Reference

The seat map — the customer's first real interaction with the product — follows the operator-provided reference convention rather than a generic grid: dark background, thin gold/yellow outline for available seats, solid gold for selected, solid grey for unavailable. Seats that share a physical table (the theater's recliner/stool pairs at a shared serving surface) render as two joined half-shapes ("D" and mirrored "D") rather than two independent boxes, using the `tableGroupId`/`tablePosition` fields on `Seat` (DATA_MODEL.md). ADA seats carry a wheelchair icon overlay; companion seats carry a "C" icon overlay; the two can appear together. A legend (Available / Unavailable / Selected / Left seat / Right seat, plus an ADA/companion note explaining that wheelchair seats are removed on request) sits above the map, with "FRONT OF THEATER" / "BACK OF THEATER" labels and a screen indicator bar orienting the customer. This is the target convention for both the customer seat map (Milestone 2) and the staff/box-office seat map (Milestone 1 for static rendering, Milestone 9 for full box-office interaction), established once in `/packages/ui` and reused everywhere a seat map appears.

Beyond the seat map specifically, the customer-facing site follows the cinematic/dark/minimal direction described in the original brief; the staff POS and KDS follow the high-contrast, large-touch-target direction also described there. No end time is ever surfaced on customer-facing showtime listings — only the start time (see DATA_MODEL.md's showtime scheduling section for why `endsAt` is computed but not displayed). Ticket checkout never includes a tip prompt; tipping only appears in the restaurant tab experience (PAYMENT_FLOW.md §3).

## 9. Assumptions

See OPEN_QUESTIONS.md for the full list. Headline assumptions: USD currency, US sales tax model (rates configurable per location, not calculated by an external tax service in MVP), Stripe as the sole payment processor initially, English-only UI, alcohol service rules are configured by the operator and not encoded as legal logic by this system.
