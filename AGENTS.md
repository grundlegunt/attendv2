# AGENTS.md — Engineering Rules for This Project

This file governs how any engineer or coding agent works in this repository. It is binding, not advisory. If a instruction elsewhere conflicts with this file, this file wins unless the project owner explicitly overrides it in writing.

Full context: read `/docs/PRODUCT_SPEC.md` and `/docs/ARCHITECTURE.md` first. Domain-specific rules live in `/docs/DATA_MODEL.md`, `/docs/STATE_MACHINES.md`, `/docs/SEAT_RESERVATION_DESIGN.md`, `/docs/PAYMENT_FLOW.md`, `/docs/RESTAURANT_WORKFLOW.md`, `/docs/SECURITY.md`.

## 1. Build in vertical slices, not layers

Do not build an entire layer (e.g., "all the database models" or "all the API endpoints") before anything works end to end. Follow `/docs/IMPLEMENTATION_PLAN.md` milestone by milestone. Each milestone must end in a demonstrable, testable workflow, per its stated completion criteria. Do not start a milestone's UI before its API and DB work is real and tested. Do not start the next milestone until the current one's completion criteria are met.

## 2. Never fake it

- Do not mark a feature complete that doesn't actually work.
- Do not stub an integration and label it "done" — label it `TODO` / `not implemented` clearly, in code comments and in any status reporting.
- Do not silently swallow errors. Every catch block either handles the error meaningfully or re-throws with context. No empty catch blocks, ever.
- Do not invent legal, tax, PCI-compliance, accounting, or alcohol-service requirements. If a rule from one of these domains is needed and not already documented in `/docs`, flag it in `/docs/OPEN_QUESTIONS.md` rather than guessing and presenting the guess as fact.

## 3. Money and seat inventory are the two things that must never be wrong

- All money fields are integer cents. Never floats.
- Every financial state transition happens inside a database transaction, matches the relevant state machine in `STATE_MACHINES.md`, and is idempotent where the spec requires it (payment confirmation, webhook handling, settlement jobs).
- No boolean `paid` flags. Payment state is always the `Payment.status` state machine.
- Seat availability is only ever changed through the locked-transaction pattern in `SEAT_RESERVATION_DESIGN.md`. There is one code path for seat hold/purchase/release (`SeatingService`), used by both `customer-web` and `staff-pos` (box office). Do not write a second path "just for box office" or "just for a quick fix."
- Any change touching seat concurrency or payment finalization requires a concurrency/idempotency test in the same PR, not a follow-up.

## 4. Payments go through the abstraction, always

Nothing outside `/packages/payments` imports the Stripe SDK. All payment operations go through the `PaymentProvider` interface. This is enforced by module boundary lint rules — a PR that imports `stripe` outside that package should fail CI, not just review.

- Never store raw PAN or CVV. Ever, in any table, log, or debug output.
- Never put real payment credentials in source control, including in tests, seed scripts, or example `.env` files. Test-mode Stripe keys only, and even those live in environment variables, not hardcoded.
- Every webhook handler verifies signatures before processing and is idempotent via `ProcessedWebhookEvent`.

## 5. Authorization is server-side, always

Every state-changing endpoint declares required permissions and is enforced by a guard, checked against `/packages/auth`'s role/permission definitions. Hiding a button in the UI is never sufficient on its own. When adding a new staff-facing capability, add its permission to `/packages/auth` and its row to the role matrix in `SECURITY.md` in the same PR — don't let the code and the documented matrix drift apart.

Role/permission definitions are code-defined, not database-editable via any admin UI, by deliberate design (`OPEN_QUESTIONS.md` §4). Do not add a "custom permission editor" without raising it as an architecture decision first.

## 6. Audit logging is part of the operation, not a side effect

Any action listed as sensitive in `SECURITY.md` §9 (refund, seat move/block, item void, comp, permission change, price change, showtime cancellation, cash adjustment, manual tab closure, etc.) writes its `AuditEvent` in the same transaction as the action. Never fire-and-forget audit logging after the response has already been sent. Never include payment credentials in an audit record.

## 7. Testing expectations

- Every milestone's completion criteria in `IMPLEMENTATION_PLAN.md` include specific tests; those are the minimum bar, not a suggestion.
- Seat concurrency tests run against a real Postgres instance with real concurrent connections/transactions — never mock away the thing being tested.
- Payment recovery/idempotency tests simulate the actual failure mode described (webhook arrives twice, browser disconnects after confirmation, etc.) rather than asserting a simplified version of the scenario.
- Permission tests must attempt the prohibited action directly against the API (not just check that a UI element is hidden) and assert a server-side rejection.
- Run flake-prone tests (concurrency, timing-based expiry) multiple times before considering them reliable, not once.
- Use Playwright for critical end-to-end customer/staff journeys (seat purchase, dining tab settlement) once those journeys are stable enough to be worth locking down with E2E coverage — not from day one on unstable flows.

## 8. Code organization rules

- Domain logic (seat holds, tab settlement calculations, order routing resolution) lives in `/packages/ticketing` and `/packages/restaurant`, written so it's testable without spinning up the full NestJS app. The `/apps/api` layer is thin: HTTP/WS concerns, guards, and wiring to these packages.
- Shared types/enums/zod schemas live in `/packages/shared` and are the single source of truth consumed by both API and frontends — do not redefine an enum like seat status independently in a frontend app.
- Strict TypeScript (`strict: true`, no implicit `any`) across every package and app.
- Favor clarity over cleverness. This is a long-lived product; a future engineer (human or agent) reading this code without this conversation's context is the audience.

## 9. Documentation stays current

If an implementation decision deviates from what's written in `/docs`, update the relevant doc in the same PR. These documents are meant to reflect the real system, not a historical proposal that's since drifted from reality. If you discover the plan was wrong once you're implementing it, fix the doc and explain why in the PR description — don't silently implement something different from what's documented.

## 10. When in doubt

Prefer the option that: keeps seat inventory and payment state provably correct under concurrency and failure, keeps PCI scope minimal, enforces authorization server-side, and is explicit rather than silent about assumptions and failures. If a requirement is genuinely ambiguous and consequential (money, legal, or irreversible data loss), raise it — add it to `/docs/OPEN_QUESTIONS.md` and flag it for the project owner — rather than guessing.
