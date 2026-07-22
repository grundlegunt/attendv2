# Implementation Plan

Status: Draft v1
Related: all other docs in this set.

Each milestone must produce something testable and end with a demo-able state. No milestone begins until the previous one's completion criteria are met. Within a milestone, build vertically (one workflow working end to end) rather than horizontally (all screens, no working flow).

## Milestone 0 — Repository, environments, auth foundation, CI

**Goal:** an empty-but-real skeleton the team can build on, not a prototype throwaway.

- **DB:** Postgres provisioned (local via Docker Compose + a hosted dev instance); Prisma initialized; first migration creates `Organization`, `Location`, `Employee`, `StaffAuthAccount`, `Role`, `Permission`, `RolePermission`, `EmployeeRole`, `Customer`, `CustomerAuthAccount`, `AuditEvent`.
- **API:** NestJS app boots, health check endpoint, environment-variable validation on boot (fails fast on missing secrets), structured JSON logger, staff login/logout/refresh endpoints, customer login/register/logout endpoints, RBAC guard framework wired (even with few real permissions yet).
- **UI:** four Next.js app shells (`customer-web`, `staff-pos`, `kds`, `admin`) created with the shared `/packages/ui` theme tokens (cinematic dark theme for customer-web, high-contrast POS theme for staff-pos/kds), each with a working login screen against the real API.
- **Tests:** unit tests for password hashing/session issuance; integration test hitting the health check and a protected route (401 without token, 200 with valid token); CI pipeline runs lint + typecheck + unit + integration on every PR.
- **Completion criteria:** a developer can `docker compose up`, run migrations/seed, log into `admin` as a seeded Owner account, and log into `staff-pos` as a seeded Server account, hitting real authenticated API calls. CI is green and blocking on PRs.

## Milestone 1 — Movies, auditoriums, seat layouts, showtimes

- **DB:** `Auditorium`, `SeatMap`, `Seat` (including `tableGroupId`/`tablePosition` for shared-table rendering), `PriceTier`, `Movie`, `Showtime` (with computed `endsAt` and the `cleaningBufferMinutes`/`preShowBufferMinutes` turnover fields on `Location`) tables + migrations.
- **API:** CRUD endpoints for auditoriums/seat maps/seats (structured JSON layout authoring, not a graphical builder — see PRODUCT_SPEC.md §6), movies, showtimes; showtime creation validates no auditorium double-booking within runtime + turnover buffers (hard rejection, per DATA_MODEL.md's "Showtime scheduling & turnover"); all gated by the relevant cinema-config permissions.
- **UI:** `admin` screens to create a location's 3 auditoriums (via structured config, e.g. rows × seats-per-row with per-seat overrides for ADA/companion/type and shared-table grouping), create movies, schedule showtimes (start time only — no end time entry, it's computed); `customer-web` "Now Playing" listing rendering real data, showtimes displayed as start times only (no ordering/seats yet). The customer- and staff-facing seat map visual convention (dark theme, thin outlined available seats, solid selected/unavailable, paired half-shapes for shared-table seats, ADA wheelchair / companion "C" icon overlays, legend, front/back-of-theater labels — see PRODUCT_SPEC.md §9) is established now in `/packages/ui` for reuse in Milestone 2's interactive map.
- **Tests:** unit tests on seat-map layout validation (no duplicate seat labels, valid coordinates, valid table-group pairing) and on turnover-overlap validation (reject a showtime scheduled without adequate buffer, accept one scheduled with exactly the minimum buffer); integration tests for the full admin flow (create auditorium → seat map → movie → showtime) via API.
- **Completion criteria:** three real auditoriums exist with distinct seat maps, at least one movie has showtimes across them with correctly computed end times and enforced turnover spacing, and `customer-web` lists real showtimes (start time only) per movie. This directly seeds the "ADMIN creates Theater → Auditorium → Seat Map → Movie → Showtime" chain from the spec's first milestone slice.

## Milestone 2 — Concurrency-safe seat availability and holds

- **DB:** `ShowtimeSeat` (generated per showtime from its seat map on showtime creation), `SeatHold`, partial unique index on active tickets (added now even though `Ticket` doesn't exist yet — the index is created against a placeholder to be finalized in Milestone 3, or deferred one milestone; documented choice: defer the partial index to Milestone 3 when `Ticket` exists, add the `ShowtimeSeat(showtimeId, seatId)` unique constraint now).
- **API:** `POST /showtimes/:id/seats/:seatId/hold`, `DELETE` (release), hold-expiry sweep job, Redis integration for TTL/pub/sub, WebSocket gateway with `showtime:{id}` room emitting `SEAT_HELD`/`SEAT_RELEASED`.
- **UI:** `customer-web` interactive seat map (SCREEN + rows/seats grid, rendered per the shared-table/ADA/companion visual convention established in Milestone 1) with live color states and a countdown timer on the customer's own held seat; `staff-pos`/box-office seat map view (read-only at this milestone) showing the same live state.
- **Tests:** the full concurrency test suite from SEAT_RESERVATION_DESIGN.md §8 (N-simultaneous-hold, hold-expires-mid-flow) — these must pass against a real Postgres instance with real concurrent connections, not mocks; this is a hard gate, not a nice-to-have.
- **Completion criteria:** two browser sessions clicking the same seat simultaneously deterministically produces one HELD and one rejected; an unattended hold expires and the seat becomes available again without manual intervention, visible in real time on a second open tab.

## Milestone 3 — Ticket checkout and test payments

- **DB:** `TicketType`, `TicketOrder`, `Ticket`, `PaymentCustomer`, `PaymentMethodReference`, `Payment`, `PaymentAttempt`, `ProcessedWebhookEvent`; the partial unique index on active tickets per seat is added here.
- **API:** checkout endpoints (create order, create PaymentIntent, finalize order), Stripe webhook endpoint (signature-verified, idempotent per PAYMENT_FLOW.md §5), `PaymentProvider`/`StripeProvider` implemented in `/packages/payments`, fee/tax calculation applied to order totals.
- **UI:** `customer-web` checkout flow (seat summary → price breakdown → Stripe Payment Element → dining-authorization opt-in prompt, explicit yes/no, neither pre-selected) and a confirmation page.
- **Tests:** ticket-purchase happy path (hold → pay → ticket created → seat SOLD); payment-recovery test (simulate webhook arriving after/instead of the frontend confirmation call, assert exactly one successful order); double-webhook test; declined-card-then-retry test.
- **Completion criteria:** a real (test-mode) Stripe card can buy a real seat end to end, seat flips to SOLD, and the payment-recovery + double-webhook tests pass reliably in CI (run them multiple times to rule out flakiness, not just once).

## Milestone 4 — Ticket issuance and QR scanning

- **DB:** `TicketScan`.
- **API:** QR token generation (signed, non-guessable, embeds ticket id + a verification signature — not just the raw ticket id), scan-verification endpoint returning `VALID/ALREADY_USED/WRONG_SHOWTIME/REFUNDED/CANCELED/INVALID`, email receipt sending (via the abstracted `EmailProvider`, real provider in test/sandbox mode).
- **UI:** digital ticket view (QR + movie/showtime/auditorium/row/seat, matching the spec's example layout) on the confirmation page and accessible later via account/link; a scanning interface (camera-based QR read on a staff device) in `staff-pos`.
- **Tests:** scan-valid-then-scan-again test (second scan reports `ALREADY_USED`, does not re-admit); wrong-showtime scan test; scan-after-refund test.
- **Completion criteria:** a purchased ticket's QR code scans as VALID once, ADMITTED is recorded with scanner identity/timestamp, and a second scan is cleanly rejected — this closes the "same QR scanned twice" edge case end to end.

## Milestone 5 — Seat-linked dining tabs

- **DB:** `RestaurantTab`, `RestaurantTabSeat`, `CustomerConsent`.
- **API:** dining-authorization consent recorded at checkout (from Milestone 3's UI, wired to a real persisted record now), tab open/lookup endpoints resolving the full seat-to-tab chain (DATA_MODEL.md §5), `RestaurantTabSummary` read query.
- **UI:** nothing customer-facing changes yet beyond the checkout opt-in already built; this milestone is primarily backend plumbing that Milestones 6–8 build on top of, verified via API tests and a minimal internal debug view rather than a polished screen.
- **Tests:** given a completed ticket order with dining authorization, opening a tab resolves customer/ticket/order/showtime/auditorium/seat/payment-method-reference correctly; multi-seat order supports both "one shared tab" and "separate tabs per seat" configurations.
- **Completion criteria:** the seat-to-tab chain in DATA_MODEL.md §5 is provably correct via automated tests for both single-seat and multi-seat/shared-tab scenarios.

## Milestone 6 — Server POS and menus

- **DB:** `MenuCategory`, `MenuItem`, `ModifierGroup`, `Modifier`, `KitchenStation`, `RestaurantOrder`, `RestaurantOrderItem`.
- **API:** menu CRUD (admin), server-facing endpoints: browse auditorium seat grid, open seat detail, build/send order, split/transfer/combine tabs; `MENU_ITEM_86D` real-time event.
- **UI:** `admin` menu management screens; `staff-pos` server flow exactly matching the spec's example (auditorium grid → seat tap → seat detail with payment-on-file indicator, current tab, ADD ITEM/SEND/SPLIT/TRANSFER/CLOSE CHECK).
- **Tests:** add-item-and-send creates correctly-routed `RestaurantOrderItem`s; 86'd-item-blocked-at-send test; split/transfer/combine tests per RESTAURANT_WORKFLOW.md §2 edge cases.
- **Completion criteria:** a server can open C4, add a Cheeseburger and an Old Fashioned, and send the order — verified both through the UI manually and via an automated integration test.

## Milestone 7 — Kitchen/bar routing and displays

- **DB:** `FulfillmentTicket`.
- **API:** order-send now generates per-station `FulfillmentTicket`s (kitchen/bar/concessions split), station-scoped real-time rooms, prep-status update endpoints (`START`/`READY`).
- **UI:** `kds` app — kitchen mode and bar mode (station filter), several-feet-legible layout, age-based visual urgency.
- **Tests:** routing test (burger → kitchen ticket only, cocktail → bar ticket only, from one order); status-transition tests (`NEW → ACCEPTED → PREPARING → READY`); refire test.
- **Completion criteria:** sending a mixed order from `staff-pos` produces the correct items on the correct display in real time, and marking ready/delivered is reflected back on the server's seat detail view live — this is the point where the spec's "KITCHEN/BAR mark items ready" step becomes real.

## Milestone 8 — Restaurant settlement and tipping

- **DB:** `TaxRule`, `ServiceChargeRule` applied to tab totals; settlement-related fields on `RestaurantTab` (`autoSettleAuthorized`, `autoSettleAt`) activated.
- **API:** live-tab customer endpoint (secure link/QR/account access), tip selection, manual pay-and-close, the automatic settlement scheduled job (PAYMENT_FLOW.md §6), `PAYMENT_FAILED`/`MANAGER_REVIEW` handling and staff alerting.
- **UI:** `customer-web` live tab view matching the spec's example (itemized bill, tip presets + custom, total, auto-close indicator, PAY & CLOSE TAB); `staff-pos`/`admin` "tabs needing attention" view for failed settlements.
- **Tests:** full dining test from the spec's testing requirements (buy ticket → authorize dining → open tab → order → kitchen ready → delivered → tip → pay → tab closes); failed-restaurant-payment test (fails cleanly, no duplicate charge, correct state, staff/customer notified); idempotent-settlement-job test (running the job twice for the same tab does not double-charge).
- **Completion criteria: this is the spec's "first end-to-end milestone."** The full chain — admin setup (Milestones 1–2) → customer buys ticket + authorizes dining (Milestone 3/5) → server orders food (Milestone 6) → kitchen/bar fulfill (Milestone 7) → customer tips and pays, or auto-settlement fires (Milestone 8) → receipt + audit trail — works reliably and is covered by automated tests end to end before any further feature work is prioritized, per the spec's explicit instruction.

## Milestone 9 — Box office POS

- **API/DB:** cash tender support (`CashDrawer`, `CashTransaction`), comp/discount application (`Promotion` minimally), seat block/house-seat actions, ticket exchange/reprint, membership lookup stub.
- **UI:** `staff-pos` box-office view — movie/showtime selection, live seat grid with sell/hold/block actions, cash and card checkout, refund/exchange screens, customer lookup.
- **Tests:** box-office sale uses the identical `SeatingService` path as online purchase (assert via a test that both channels hit the same locking code path — guards against future drift into a second inventory system); cash-and-card mixed tender test; refund/exchange tests.
- **Completion criteria:** a box-office employee can sell, hold, and block seats on the same live inventory customers see online, take cash, and issue a refund — all permission-gated and audited.

## Milestone 10 — Management, refunds, reporting, audit tools

- **API/DB:** reporting queries/read-models for the ticketing/F&B/operations/finance report groups listed in the product spec; audit-log query endpoints; refund workflows fully generalized (ticket/restaurant/both, threshold-based approval routing from SECURITY.md §2.1).
- **UI:** `admin` dashboards for each report group, audit log viewer with filters, full config screens for taxes/service charges/promotions/users/permissions.
- **Tests:** report-accuracy tests (known seeded data produces expected revenue/occupancy numbers); permission tests covering every role listed in SECURITY.md's matrix, asserting prohibited actions are rejected server-side even with a forged/guessed request.
- **Completion criteria:** a GM can see accurate ticketing/F&B/operations/finance numbers for a seeded test period, and the full RBAC test suite passes for every role.

## Milestone 11 — Security hardening, observability, load testing, operational readiness

- Full audit-logging coverage review against the spec's example list; rate-limiting tuned; dependency/vulnerability scanning in CI; secrets rotated out of any placeholder/dev values before any real deployment; Playwright E2E suite covering the critical customer/staff journeys named in this plan; load/concurrency testing at a realistic multi-auditorium, multi-showtime scale (not just the single-seat race tests from Milestone 2 — full showtime sellout scenarios); production deployment topology finalized (infra decisions currently open, see OPEN_QUESTIONS.md); monitoring/alerting/on-call-readiness for payment and seat-inventory failure modes specifically.
- **Completion criteria:** the system has been load-tested against a plausible real opening-night scenario (full auditorium selling out concurrently, simultaneous heavy restaurant ordering across all three auditoriums) without correctness violations, and a documented incident-response path exists for payment processor outages and seat-inventory anomalies.

## Sequencing notes

- Milestones 0–4 are strictly ticketing; no restaurant code is written until seat purchase is solid, per the spec's instruction not to build everything at once.
- Milestones 5–8 are the restaurant chain, culminating in the exact end-to-end slice the spec names explicitly — treat Milestone 8's completion as the real proof point of this entire project, not a formality.
- Milestones 9–11 broaden operational surface (box office, management, hardening) once the core customer/server/kitchen loop is proven, not before.
- **Fallback checkpoint:** Milestone 4's completion (ticket purchase + QR issuance + scanning, no restaurant features) is a legitimate, independently launchable product on its own — a straightforward reserved-seat ticketing platform for the theater. If the restaurant integration (Milestones 5–8) proves harder than expected once underway, the plan already supports pausing at Milestone 4, shipping ticketing alone, and picking the restaurant build back up later without rework — this was a deliberate sequencing choice, not an afterthought.
