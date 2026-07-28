# Payment Flow

Status: Draft v1
Related: SECURITY.md, STATE_MACHINES.md (Payment, RestaurantTab), DATA_MODEL.md, SEAT_RESERVATION_DESIGN.md

## 1. Provider abstraction

All payment operations go through a `PaymentProvider` interface in `/packages/payments`. Nothing outside this package imports the Stripe SDK directly. This is a hard rule (enforced by lint boundary config in AGENTS.md), not a suggestion, because it's the only way "not permanently coupled to one processor" is actually true rather than aspirational.

```ts
interface PaymentProvider {
  createCustomer(customer: { email?: string; name?: string }): Promise<ProviderCustomerRef>;
  attachPaymentMethod(customerRef, setupIntentResult): Promise<PaymentMethodRef>; // display-safe fields only
  createPaymentIntent(args: { customerRef; amountCents; currency; metadata; idempotencyKey }): Promise<PaymentIntentRef>;
  confirmOffSession(args: { customerRef; paymentMethodRef; amountCents; idempotencyKey; metadata }): Promise<PaymentResult>;
  refund(args: { providerPaymentId; amountCents; reason; idempotencyKey }): Promise<RefundResult>;
  verifyWebhookSignature(rawBody, signatureHeader): ProviderEvent;
}
```

`StripeProvider implements PaymentProvider` is the only concrete implementation for MVP. Swapping processors later means writing a new implementation and a data migration for `PaymentMethodReference.provider`/`providerPaymentMethodId` — it does not mean touching ticketing or restaurant domain code, which only ever calls the interface.

## 1.1 Multi-tenant payment routing (Stripe Connect)

Per PRODUCT_SPEC.md §1.1, this platform is multi-tenant from day one — each `Organization` is a theater business that needs to receive *its own* ticket and food/beverage revenue directly, not have it pool into one platform-operator account. This is the standard "marketplace/platform payments" pattern, and Stripe's implementation of it is **Stripe Connect**:

- Each `Organization` gets its own Stripe **connected account**, created during onboarding (Stripe's hosted onboarding flow handles the identity/banking verification — this platform never collects or stores a theater's banking details directly, same PCI-scope-minimization principle as §2 below applied to the theater's payout information, not just the customer's card).
- `Organization` gains a `stripeConnectedAccountId` field (DATA_MODEL.md). Every `PaymentIntent`/`SetupIntent` created for that organization's customers is created **on behalf of that connected account**, so funds settle directly to the theater's own bank account, not the platform's.
- The platform's own revenue (subscription fee and/or a small application fee per transaction, pricing model TBD — see OPEN_QUESTIONS.md) is collected via Stripe Connect's `application_fee_amount` mechanism, deducted automatically at the time of each charge rather than invoiced separately — this keeps the platform's own revenue collection just as automatic and idempotent as everything else in the payment flow.
- The `PaymentProvider` interface (§1) gains an organization/connected-account parameter on every method — this is a mechanical extension of the existing abstraction, not a redesign of it, since the interface was already written so nothing outside `/packages/payments` knows processor-specific details.
- **The founder's own theater uses this exact same path.** It is Organization/tenant #1 with its own connected account like any other customer, per the product owner's explicit instruction — there is no "internal" payment path that bypasses Connect.

Milestone 3 implementation status (2026-07-26): the provider boundary,
connected-account routing, onboarding-state fields, test-mode key enforcement,
and checkout readiness guard are implemented. A cinema cannot accept a live
checkout until it has a valid `acct_…` connected account. Hosted onboarding UI
remains an operator setup task; no platform-account fallback is allowed.

## 1.2 Card-present payments (Stripe Terminal)

Confirmed (2026-07-25): in-person card collection — a card that isn't already on file, used either to split a check at the table (§6.1) or for a box-office customer paying by card (IMPLEMENTATION_PLAN.md Milestone 9) — goes through **Stripe Terminal**, not the customer-facing web tokenization flow in §1-§2. This is a distinct Stripe product (physical, PCI-validated card readers — e.g. a BBPOS or WisePOS E device — paired to a `staff-pos` device via the Terminal SDK), not a repurposing of the online Payment Element flow.

- The `PaymentProvider` interface (§1) gains card-present methods: `collectCardPresentPayment(args: { connectedAccountId; readerId; amountCents; currency; metadata; idempotencyKey }): Promise<PaymentResult>`, plus reader discovery/connection management (`listReaders`, `connectReader`) scoped per `Location`. `StripeProvider` implements these against Stripe Terminal's API the same way it implements the online methods against Payment Intents — one interface, two device-classes of implementation, nothing outside `/packages/payments` needs to know the difference.
- Routes through the same per-tenant Stripe Connect account as every other payment (PAYMENT_FLOW.md §1.1) — a reader is registered to a specific connected account/location, so funds still land directly with the theater.
- PCI scope stays low here too, just via a different mechanism than tokenized web entry: Stripe's Terminal readers are PCI-validated point-to-point encryption (P2PE) devices — card data is encrypted at the moment of tap/dip/swipe and never passes through this platform's servers or the staff device's own software in readable form. This keeps scope minimal (SAQ B-IP-equivalent for the card-present channel) but it is a **different SAQ category than the SAQ A story for online checkout** (§2, SECURITY.md §2) — worth stating precisely rather than implying one PCI story covers both channels.
- Hardware is a real, recurring cost (reader purchase per register/section, plus Stripe's card-present processing rate, which typically differs from the online rate) — worth factoring into the pricing-model decision in OPEN_QUESTIONS.md §1.1, not just an engineering line item.
- Scope: Milestone 8 (check-drop split-tender) and Milestone 9 (box-office card sales) both depend on this — see IMPLEMENTATION_PLAN.md.

## 2. Tokenization — what we store, what we never store

We never receive, transmit, or store raw PAN or CVV. Card entry happens in Stripe Elements/Payment Element, a Stripe-hosted iframe — card data goes directly from the customer's browser to Stripe. Our backend only ever sees a `PaymentMethod` id (a token) and Stripe-provided display metadata (brand, last4, exp). This is what keeps our PCI scope at SAQ A rather than something requiring us to handle cardholder data directly (see SECURITY.md §2 for the explicit PCI scope statement and its limits).

Saved payment methods: at checkout, if the customer opts in ("keep this payment method for food and drinks"), we create a Stripe `Customer` (if one doesn't exist for this `Customer` record) and a `SetupIntent` with `usage: off_session`, so the resulting `PaymentMethod` is explicitly authorized for later off-session charges — this is a Stripe/card-network requirement, not an internal preference, and it's also literally what "authorize this for later" needs to mean technically.

## 3. Ticket checkout payment flow

1. Customer completes seat selection (holds active). Frontend requests a `PaymentIntent` for the order total (`tickets + online fee + tax`), server-side, using the `TicketOrder.id` as part of the idempotency key.
2. Customer confirms payment via Stripe Payment Element (handles 3DS/SCA `REQUIRES_ACTION` automatically in the client SDK).
3. Frontend receives confirmation, calls our API's "finalize order" endpoint, which independently verifies the `PaymentIntent` status server-side via Stripe's API (never trusts the client's word alone) before running the purchase transaction from SEAT_RESERVATION_DESIGN.md §3.2.
4. In parallel (belt-and-suspenders, not a race), Stripe's webhook (`payment_intent.succeeded`) also arrives and hits the same finalize path — see §5 for why this is safe.
5. Optional dining authorization: if the customer opted in, the `SetupIntent` confirmation runs alongside checkout, and a `CustomerConsent(type=DINING_AUTO_SETTLEMENT)` row is written with `termsVersion` and `grantedAt` — only ever recorded on an explicit, separate opt-in action, never implied by completing ticket checkout. The checkout UI must show both explicit options (`YES`/`NO`) with neither pre-selected as a default that requires deselection.
6. **Ticket checkout never includes a tip prompt.** Tipping is not a norm for box-office/online ticket purchase and is not collected here under any circumstance — it only ever appears in the restaurant tab flow (§4), where it's tied to service actually rendered by a server/bartender.

### Milestone 3 implementation evidence

- `TicketOrder`, `Ticket`, `TicketType`, `Payment`, `PaymentAttempt`, `Refund`,
  `PaymentCustomer`, `PaymentMethodReference`, and
  `ProcessedWebhookEvent` are migration-backed PostgreSQL records.
- Checkout totals are calculated server-side in integer cents. Ticket tax uses
  the location's configured basis-point rate; the seed remains `0` until the
  operator confirms the applicable rate.
- Payment Element is used for card entry and eligible wallets such as Apple Pay.
  Attend never receives PAN or CVV.
- Finalization retrieves payment status from Stripe server-side, then locks the
  order, holds, and shared `ShowtimeSeat` inventory before issuing tickets.
- Browser disconnect recovery and duplicate webhooks converge on the same
  idempotent finalizer.
- A successful charge whose seat can no longer be finalized creates one
  idempotent refund. A failed refund writes an operational audit alert.

## 4. Restaurant tab payment flow

Two paths, both landing in the same `Payment(purpose=RESTAURANT_TAB)` state machine:

**Customer-initiated (live tab, manual pay):** customer opens their live tab (via link/QR/account), selects a tip, taps "Pay & Close Tab." This is an on-session charge against either their saved method or a newly entered one — straightforward `PaymentIntent` confirmation, same pattern as ticket checkout.

**Check-drop settlement (the normal path):** see §6.1. **Automatic settlement (fallback, pre-authorized only):** see §6.2.

Split/partial payment (e.g., part cash, part card, or splitting a multi-seat tab across payers) is modeled as multiple `Payment` rows against one `RestaurantTab`, each covering a portion of the total; the tab is `CLOSED` only once the sum of `SUCCEEDED` payments (plus any recorded comps/cash) equals the tab total. Cash payments create a `Payment` row with `paymentMethodReferenceId = null`, `status = SUCCEEDED` immediately upon staff confirmation (cash can't "fail" asynchronously), and a linked `CashTransaction` for drawer reconciliation. This multiple-tender-lines-per-check model is standard practice among restaurant POS platforms (Toast, Square, and Micros all model split tender the same way), confirmed as the right approach — no true "single blended transaction" split-tender UX is needed.

## 5. Payment succeeds but the browser disconnects / webhook arrives twice

This is the scenario the spec calls out explicitly and it's handled by one mechanism, not two special cases:

- The "finalize" operation (whether triggered by the frontend's post-confirmation call or by the webhook) is wrapped in `Payment.idempotencyKey` (unique DB constraint) plus `ProcessedWebhookEvent.providerEventId` (unique DB constraint) for the webhook path specifically.
- Before doing any writes, the handler checks: is there already a `Payment` row for this `idempotencyKey` in a terminal success state? If yes, it's a no-op that returns the existing result. This means: browser disconnects after Stripe confirms but before our frontend call lands → the later-arriving webhook finalizes it exactly once. Frontend call *and* webhook both arrive → whichever gets the row lock first finalizes, the second sees it's already done and no-ops. Webhook delivered twice (Stripe's documented at-least-once behavior) → `ProcessedWebhookEvent` unique constraint rejects the duplicate before any business logic runs.
- Webhook signature verification (`Stripe-Signature` header, verified against the raw request body using the webhook signing secret) happens before anything else, rejecting unsigned/forged requests — this is also what prevents replay-style abuse of the webhook endpoint as an attack surface.

## 5.1 Payment succeeds but seat finalization fails

A distinct failure mode from §5 above — not duplicate processing, but a genuine case where the charge succeeded and the seat is legitimately no longer available to this customer (their `SeatHold` expired, or in a rare race, was otherwise invalidated, before the finalize transaction ran). This must never mean "customer is charged, gets nothing, and the system has no defined next step" — that gap was real; this closes it.

1. The finalize handler (§3 step 3, whether triggered by the frontend call or the webhook) attempts the purchase transaction from SEAT_RESERVATION_DESIGN.md §3.2 *after* confirming the `Payment` succeeded. If that transaction's hold/seat validity check fails, the ticket purchase does not happen: no `Ticket` is created, `ShowtimeSeat.status` is untouched, `TicketOrder` moves to `EXPIRED` (STATE_MACHINES.md §2) — this part was already designed.
2. **What was previously undefined:** the `Payment`, which already succeeded, doesn't just sit there. In the same transaction that marks the order `EXPIRED` for this specific reason, the system creates a `Refund` (reason `SEAT_UNAVAILABLE_AFTER_PAYMENT`, `initiatedByEmployeeId = null` — system-initiated, not staff-initiated) and immediately attempts it against the `PaymentProvider`, using an idempotency key derived from `Payment.id` so a retried handler can't double-refund.
3. On refund success: `Payment.status = REFUNDED`, the customer sees/is emailed a clear explanation (charged, then automatically refunded because the seat became unavailable), and is returned to seat selection.
4. On refund failure — rare, but must be handled, e.g. the card was closed between charge and refund attempt — this is money the platform is holding against a purchase that never completed, arguably the single worst state to leave unattended in the entire system. It routes to the same `MANAGER_REVIEW`-style staff alert already used for restaurant settlement failures (§6.2), never a blind automatic retry.
5. **Required test, not optional:** Stripe payment success immediately followed by seat-finalization failure must be proven, in CI, to produce exactly zero `Ticket` rows, an unchanged `ShowtimeSeat.status`, exactly one refund attempt, and — with a mocked refund failure — a fired staff alert. Both the refund-succeeds and refund-fails sub-paths need coverage, not just the happy path.

## 6. Tab settlement: check-drop (primary) and automatic (fallback)

Confirmed (2026-07-25): the primary settlement path is staff-driven, matching how service actually works, not a silent background job. A background job still exists, but strictly as a safety net for a check that never got dropped, not as the intended everyday path.

### 6.1 Check-drop settlement (primary path)

Trigger: `showtime.endsAt - checkDropMinutesBeforeEnd` (new `Location` field, default 30 minutes, configurable — sits alongside `cleaningBufferMinutes`/`preShowBufferMinutes`, DATA_MODEL.md). At this point, open tabs for that showtime surface in the server's `staff-pos` queue as "checks due." This is a reminder, not an automatic action — nothing happens to the tab or the guest until a server acts.

1. **Server drops the check.** A real staff action in the POS (`RestaurantTab.checkDroppedAt`/`checkDroppedByEmployeeId` recorded, DATA_MODEL.md) — conceptually the same moment as physically placing the paper check on the table. This does not lock the tab against further orders.
2. **One last order is still allowed.** A guest can order one more item after the check drops; the server sends it normally (§3), and it's added to the tab before the final total is computed. This is expected, ordinary behavior, not an edge case to guard against.
3. **The server finalizes and collects payment**, at which point the tab moves `OPEN → READY_TO_CLOSE` (STATE_MACHINES.md §5). This is the actual "closed" moment from the guest's perspective — dropping the check plus finalizing it is the transaction closing, not a background process closing it later.
4. **Payment is not required to be a single charge to the card used at ticket checkout.** The finalize step supports the same split-tender mechanism already used elsewhere (§4/§7) — multiple `Payment` rows against the one tab, any mix of the pre-authorized card, a different card presented at the table, or cash, summing to the tab total. The dining-authorization card captured at ticket checkout is the *default*, not a requirement — staff can split across however many cards the table hands over.
5. Once payment is collected (in full, across however many `Payment` rows), the tab moves `READY_TO_CLOSE → SETTLEMENT_PENDING → CLOSED`, receipt issued (STATE_MACHINES.md §5).

### 6.2 Automatic settlement (fallback only)

If a tab's check was never dropped and it's still `OPEN`/`PREAUTHORIZED` as the room approaches turnover, the same automatic job originally designed as the primary path now runs as a backstop, protecting the next showing's turnover rather than being the expected experience:

Trigger: `showtime.endsAt` + a short grace period (default 5 minutes), evaluated by a scheduled job, only for tabs where `checkDroppedAt IS NULL` and `status` is still `OPEN`/`PREAUTHORIZED`. This window is deliberately tight: the tab must be fully settled before the location's `cleaningBufferMinutes` (default 15) is needed for the next showtime's turnover.

1. Lock the tab row; re-check it's still open (guards the "server finalizes right as the fallback job fires" race).
2. Transition to `SETTLEMENT_PENDING`.
3. Compute subtotal from `RestaurantOrderItem`s (excluding voided/canceled). Tip is calculated against this pre-tax, pre-service-charge subtotal (matching RESTAURANT_WORKFLOW.md §7), using the customer's prior live-tab selection if one was made; if the customer never opened the live tab, tip defaults to the location's configured auto-settlement tip policy (see OPEN_QUESTIONS.md — the system never invents a tip amount beyond that configured default). `TaxRule`s and any `ServiceChargeRule`s are then applied to the subtotal per their own configured base. Final total = subtotal + tax + service charge + tip, all itemized separately on the receipt.
4. Attempt `confirmOffSession` against the authorized `PaymentMethodReference` (the only method available here, since no staff finalize/split happened) — an idempotency key derived from `(tabId, settlementCycle)` guards a retried job run from double-charging.
5. On success: `Payment.status = SUCCEEDED`, tab → `CLOSED`, receipt emailed.
6. On failure: `Payment.status = FAILED`, tab → `PAYMENT_FAILED`, staff alerted (dashboard + notification), customer notified with a link to pay with a different method. **The job does not retry automatically on a fixed schedule** — repeated blind retries against a declining card are explicitly disallowed by the spec. A human (staff) or the customer (via the live-tab link) must trigger the next attempt, which is a fresh, explicit action, not the job re-firing.
7. If failures persist past a configured attempt count or time window, tab → `MANAGER_REVIEW`.

## 7. Refunds

Refunds are always scoped explicitly (`TICKET`, `RESTAURANT`, or `BOTH`) — never an undifferentiated "refund the order," because tickets and dining tabs settle independently (see RESTAURANT_WORKFLOW.md edge cases). A `Refund` row references the specific `Payment` it reduces and requires the `payment.refund` permission. Refunding a ticket does not touch its `RestaurantTab`; refunding restaurant items does not touch the `Ticket`. Both refund paths write an `AuditEvent` with before/after amounts and the initiating employee.

**MVP refund policy: full refunds only (100%).** There is no partial-refund staff workflow and no dollar-threshold approval-escalation tier for MVP — any employee holding `payment.refund` can issue a full refund on a ticket or tab directly (confirmed business decision). The schema does not hardcode this (`Refund.amountCents` can represent less than the full payment), so partial refunds remain available as a later phase without a migration, but no UI/workflow exposes it now.

## 8. Webhook events consumed (MVP set)

`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action` (logged, primarily handled client-side), `setup_intent.succeeded`, `setup_intent.setup_failed`, `charge.refunded`, `charge.dispute.created` (routed to a manager alert + `AuditEvent`, no automated action taken on disputes in MVP).

## 9. Rate limiting and abuse protection on payment endpoints

Checkout and payment-confirmation endpoints are rate-limited per session/IP (Redis-backed) independent of the general API rate limit, since these endpoints are the most attractive target for card-testing abuse. Failed-payment velocity per customer/session is tracked and can trigger a temporary checkout cooldown, configurable, without blocking legitimate retries within a reasonable window.

## 9.1 Connectivity is a hard requirement, not a soft assumption

Stated explicitly (2026-07-25) so nobody assumes otherwise: MVP requires internet connectivity to operate. If a location's internet goes down, box office can't sell tickets, Stripe Terminal card-present collection won't function, servers can't send orders, the KDS/BDS won't receive new tickets, and ticket scans can't verify against the API. Offline-first behavior (queued sales, local-only verification, deferred sync) is explicitly **not** built for MVP — it would be a significant architectural undertaking of its own, not an incremental add. This is a real operational risk worth a location having a manual fallback plan for (comparable to any modern POS/payment system), but it is out of scope here, not silently assumed to be handled.

## 10. What this document explicitly does not claim

This design minimizes PCI scope and follows Stripe's recommended integration patterns, but **the application does not become "PCI compliant" merely by using a tokenized processor** — compliance also depends on infrastructure hardening, organizational policies, and a completed SAQ, which are operational/compliance activities outside this codebase's scope. See SECURITY.md §2.
