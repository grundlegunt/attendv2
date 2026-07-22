# Open Questions and Assumptions

Status: Draft v1 — please review before Milestone 0 begins. Items here are either explicit assumptions made to keep the architecture moving, or decisions that genuinely belong to the business/product owner, not engineering.

## 1. Decisions received from product owner (2026-07-22) — resolved

- **Tip prompt scope.** Ticket checkout never prompts for a tip. Tipping only ever appears in the restaurant/dining tab flow. Implemented in PAYMENT_FLOW.md §3/§4.
- **Showtime end time & auto-settlement timing.** No end time is manually entered or shown to customers. `Showtime.endsAt` is computed as `startsAt + movie.runtimeMinutes` (runtime is treated as running through the credits). After a showtime ends: 15 minutes for cleaning, then the next showtime's pre-show window (15 minutes for customer entry/ordering + 15 minutes of trailers) before its start — a fixed 45-minute auditorium turnover, enforced when scheduling showtimes. Auto-settlement fires shortly after `endsAt` (default 5-minute grace), because the tab must be fully settled before the cleaning window is needed for the next audience. Detailed in DATA_MODEL.md's new "Showtime scheduling & turnover" section and PAYMENT_FLOW.md §6.
- **Refund policy.** Full refunds only (100%) for MVP — no partial-refund workflow, no dollar-threshold escalation tier. Any role with the `payment.refund` permission can issue a full refund directly. See SECURITY.md §2.1 footnote and PAYMENT_FLOW.md §7.
- **Screening-cancellation comp policy.** Confirmed: comped. Canceled showtimes automatically refund all tickets and comp (write off, or refund if already charged) any open/delivered restaurant tabs for that showtime — no per-incident staff judgment call required. See RESTAURANT_WORKFLOW.md §8.
- **Split-tender on restaurant payments.** Confirmed acceptable as designed: multiple `Payment` rows against one tab (e.g., one cash, one card), summing to the total. This is standard practice among restaurant POS systems (Toast, Square, and Micros all model split tender the same way — separate tender lines against one check, not one blended transaction), so no redesign was needed.
- **Membership program.** Confirmed lookup/attach stub only for MVP; a real program is a future phase, not required now.
- **Multi-location.** Confirmed as a genuine goal, years out — including a possible pitch of this platform as a service to other independent theaters. This is exactly why `Organization` is modeled as the top-level tenant boundary already (ARCHITECTURE.md, DATA_MODEL.md): the door is intentionally being kept open. True multi-tenant hardening (per-tenant data isolation guarantees, billing/metering, tenant-scoped admin) is a distinct, larger effort that should be scoped deliberately if/when it's pursued — not built speculatively now.

## 2. Recommendations (pending your confirmation, not blocking current work)

- **Hosting.** Recommended: Vercel for the four Next.js frontends, and Railway (or Render as a close second) for the NestJS API, PostgreSQL, and Redis. Reasoning: minimal operational burden for a small team, inexpensive to start, both are Docker-compatible so a later move to AWS/GCP — relevant if the multi-location/SaaS ambition above materializes — is a re-platform, not a rewrite. This doesn't need to be locked in until Milestone 11.
- **Email provider.** Recommended: Postmark — strong transactional deliverability, simple API, good for receipts/confirmations. Sits behind the existing `EmailProvider` abstraction either way.
- **SMS provider.** Recommended: Twilio, the de facto standard. Worth confirming whether SMS is actually needed for MVP launch (order-ready pings, settlement failure alerts) or can wait — it adds cost and a second provider integration for a channel email may cover adequately at first.

## 3. Assumptions made to keep the architecture concrete

- Currency: USD. Locale: US sales-tax model (location-configurable flat rates per tax category, not an external tax-calculation service) and English-only UI for MVP.
- Payment processor: Stripe, test/sandbox mode throughout development, behind the `PaymentProvider` abstraction so this is revisitable without a rewrite.
- Auditorium layouts authored via structured configuration (rows/seats/attributes as data), not a graphical drag-and-drop designer, for MVP — per the spec's own permission to make this trade-off if a graphical builder would delay the core system.
- Native mobile apps are out of scope for MVP; APIs are designed to be reusable by a future native client but none is built now.
- Apple/Google Wallet integration is architected for (ticket data model supports it) but not implemented in MVP.
- "One theater location, three auditoriums" is the literal MVP deployment target; the data model supports more without a schema change.
- Tax and service-charge calculation is a configurable-rules engine at the rate level, not a full tax-jurisdiction determination service — appropriate for a single physical location, would need revisiting for multi-location/multi-jurisdiction.
- No legal, tax, alcohol-licensing, or accounting requirement has been independently researched or asserted as fact anywhere in this documentation set; every place the system touches these domains, it exposes configuration rather than encoding a specific jurisdiction's rule as if it were universally true. Confirm applicable requirements with qualified counsel/accountant before go-live.
- PCI: SAQ A scope is targeted via tokenization (SECURITY.md §3); this is not a claim of compliance, only a scope-reduction design choice.

## 4. Technical decisions flagged as revisitable, not final

- Prisma over Drizzle (ARCHITECTURE.md §3) — revisit if seat-reservation-path query performance under real load proves Prisma's overhead material; the domain layer's use of raw SQL for the hot path already limits how much this decision matters.
- NestJS as a separate API service rather than a Next.js backend (ARCHITECTURE.md §2) — revisit only if the operational overhead of a second service proves not worth the modularity benefit, unlikely given the real-time/job/webhook needs.
- Exact production hosting topology — deferred to Milestone 11 by design, not an oversight.

## 5. Explicitly flagged risks

- **Automatic settlement is a real money-movement feature triggered without a human in the loop, and now runs on a tighter clock.** With the confirmed turnover model, settlement must complete within roughly the 15-minute cleaning window after a showtime ends, not a leisurely 30+ minute buffer. It is designed with idempotency, explicit consent, no-blind-retry, and staff alerting, but it is the single highest-blast-radius feature in the system if a bug exists in the trigger/amount-calculation logic, and the tighter window raises the cost of any processing delay. Recommend this specific path gets the most thorough testing and a staged rollout (e.g., manual-confirm-required mode available as a configuration fallback) before relying on it unattended in production.
- **Turnover scheduling is now a hard validation, not a soft suggestion.** Because auto-settlement timing depends on it, a bug in the showtime-overlap validation (DATA_MODEL.md) doesn't just risk a double-booked auditorium — it risks the settlement job's assumptions about when a room needs to be clear. Cover this validation with tests as carefully as seat concurrency.
- **QR ticket tokens must be unguessable and signed**, not sequential ids — implemented as such (SEAT-to-QR design in Milestone 4), flagged here because a guessable ticket token would allow ticket forgery/scan fraud.
- **Webhook endpoint is an internet-facing endpoint that triggers financial state changes** — signature verification (SECURITY.md §5) is the entire defense; this must never be weakened or bypassed for debugging convenience, including in staging.
- **Role/permission definitions living in code, not admin-editable**, is a deliberate anti-privilege-escalation choice (DATA_MODEL.md, Employee/Role/Permission section) — flagging so it's not "fixed" later by someone adding a permission-editor UI without recognizing why it was avoided.
