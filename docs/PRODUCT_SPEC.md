# Product Specification — Dine-In Cinema Platform

Status: Draft v1 (architecture phase, pre-implementation)
Owner: Engineering
Related docs: ARCHITECTURE.md, DATA_MODEL.md, STATE_MACHINES.md, SEAT_RESERVATION_DESIGN.md, PAYMENT_FLOW.md, RESTAURANT_WORKFLOW.md, SECURITY.md, IMPLEMENTATION_PLAN.md, OPEN_QUESTIONS.md

## 1. Vision

Build a single platform that runs an independent dine-in movie theater end to end: reserved-seat ticketing (online and box office) and restaurant point-of-sale, unified by one rule — **every food and drink order is tied to a seat, and every seat is tied to a showtime, a ticket, and a customer.** The customer's tab follows them from the moment they buy a ticket to the moment they tip and pay, without re-identifying themselves to a server.

This is being built as the foundation of a real product, not a prototype. It must eventually run a live, multi-screen, paying business. That means correctness on money and seat inventory is non-negotiable, even though the UI and feature surface will grow incrementally.

## 2. Core Domain Concepts (shared vocabulary)

These concepts are shared between ticketing and restaurant operations. Both subsystems are views over the same data, not two systems that sync with each other.

- **Organization** — the company operating one or more theaters. Single-tenant in practice for MVP, modeled multi-tenant-ready.
- **Location** — a physical theater property.
- **Auditorium** — a screen/room within a location, with a seat map.
- **SeatMap / Seat** — the physical seating layout and each seat's static attributes.
- **Movie / Showtime** — what's playing and when, in which auditorium.
- **ShowtimeSeat** — the per-showtime instance of a seat (this is where availability state lives).
- **SeatHold** — a temporary claim on a ShowtimeSeat during checkout.
- **Customer** — a person with or without an account (guest checkout supported).
- **TicketOrder / Ticket** — a purchase transaction and the individual admission credentials it produced.
- **RestaurantTab / RestaurantTabSeat** — the running bill associated with one or more seats for a showtime.
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

Movie → Showtime → interactive seat map → seat selection (held, countdown shown) → checkout (tickets + fees + tax) → optional dining payment authorization (explicit opt-in, never silent) → payment → seat marked SOLD → QR ticket issued (confirmation page + email) → customer arrives, is seated → server identifies the seat in the POS and sees "payment on file" → orders are placed against the seat → kitchen/bar receive routed items in real time → items marked ready/delivered → customer views live running tab on their phone → customer selects tip → customer pays (auto-settlement if pre-authorized and past the configured trigger point, or manual pay) → tab closes → receipt issued → reporting and audit trail updated.

## 5. MVP Scope

In scope for the first shippable version (see IMPLEMENTATION_PLAN.md for milestone breakdown):

- One location, three auditoriums, structured (non-drag-and-drop) seat map configuration.
- Movies, showtimes, reserved seating, concurrency-safe holds.
- Online ticket purchase with convenience fee and tax; guest checkout and basic accounts.
- Box office sales sharing the same seat inventory as online sales.
- QR ticket issuance and scanning with re-use/wrong-showtime/refunded detection.
- Seat-linked restaurant tabs, one tab per seat by default with support for combining seats into one tab at checkout or by staff.
- Server tablet POS: seat-scoped ordering, send, split, transfer, close.
- Menu management with categories, modifiers, 86'ing, kitchen destination.
- Kitchen display and bar display with real-time status.
- Stripe-backed saved payment methods, dining authorization consent, tipping, manual and automatic settlement.
- Refunds (ticket and restaurant, independently).
- Manager dashboard: core config entities, refunds/comps, basic reporting, audit log viewer.
- RBAC enforced server-side across all the roles listed above.

## 6. Explicitly Out of Scope for MVP

- Native iOS/Android apps (responsive web only; APIs designed so native clients can be added later).
- Full Apple Wallet / Google Wallet pass issuance (architected for, not built).
- Graphical drag-and-drop auditorium designer (structured JSON/config-based layout authoring instead).
- Multi-location support beyond data-model readiness (single location operates in MVP).
- Gift cards, memberships beyond a lookup stub, promotions engine beyond a simple discount code.
- Split cash/card tender on a single restaurant payment (recorded as two payments against one tab instead — see OPEN_QUESTIONS.md).
- Real payment processing (Stripe test mode only throughout development).

## 7. Success Criteria for the First Vertical Slice

Defined in full in IMPLEMENTATION_PLAN.md ("Milestone 5/6/7 integration slice"), but at a glance: an admin can stand up one auditorium/movie/showtime, a customer can buy seat C4 and optionally authorize dining payment, a server can open C4's tab and send a burger to the kitchen and a cocktail to the bar, kitchen/bar can mark items ready, the customer can view their live tab, tip, and pay, and the tab closes with a receipt and audit trail. Nothing else is prioritized until this works reliably under test, including a concurrency test proving two simultaneous buyers cannot both win seat C4.

## 8. Visual Design Reference

The seat map — the customer's first real interaction with the product — follows the operator-provided reference convention rather than a generic grid: dark background, thin gold/yellow outline for available seats, solid gold for selected, solid grey for unavailable. Seats that share a physical table (the theater's recliner/stool pairs at a shared serving surface) render as two joined half-shapes ("D" and mirrored "D") rather than two independent boxes, using the `tableGroupId`/`tablePosition` fields on `Seat` (DATA_MODEL.md). ADA seats carry a wheelchair icon overlay; companion seats carry a "C" icon overlay; the two can appear together. A legend (Available / Unavailable / Selected / Left seat / Right seat, plus an ADA/companion note explaining that wheelchair seats are removed on request) sits above the map, with "FRONT OF THEATER" / "BACK OF THEATER" labels and a screen indicator bar orienting the customer. This is the target convention for both the customer seat map (Milestone 2) and the staff/box-office seat map (Milestone 1 for static rendering, Milestone 9 for full box-office interaction), established once in `/packages/ui` and reused everywhere a seat map appears.

Beyond the seat map specifically, the customer-facing site follows the cinematic/dark/minimal direction described in the original brief; the staff POS and KDS follow the high-contrast, large-touch-target direction also described there. No end time is ever surfaced on customer-facing showtime listings — only the start time (see DATA_MODEL.md's showtime scheduling section for why `endsAt` is computed but not displayed). Ticket checkout never includes a tip prompt; tipping only appears in the restaurant tab experience (PAYMENT_FLOW.md §3).

## 9. Assumptions

See OPEN_QUESTIONS.md for the full list. Headline assumptions: USD currency, US sales tax model (rates configurable per location, not calculated by an external tax service in MVP), Stripe as the sole payment processor initially, English-only UI, alcohol service rules are configured by the operator and not encoded as legal logic by this system.
