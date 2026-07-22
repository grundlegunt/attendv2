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

## 4. Restaurant tab payment flow

Two paths, both landing in the same `Payment(purpose=RESTAURANT_TAB)` state machine:

**Customer-initiated (live tab, manual pay):** customer opens their live tab (via link/QR/account), selects a tip, taps "Pay & Close Tab." This is an on-session charge against either their saved method or a newly entered one — straightforward `PaymentIntent` confirmation, same pattern as ticket checkout.

**Automatic settlement (pre-authorized):** see §6.

Split/partial payment (e.g., part cash, part card, or splitting a multi-seat tab across payers) is modeled as multiple `Payment` rows against one `RestaurantTab`, each covering a portion of the total; the tab is `CLOSED` only once the sum of `SUCCEEDED` payments (plus any recorded comps/cash) equals the tab total. Cash payments create a `Payment` row with `paymentMethodReferenceId = null`, `status = SUCCEEDED` immediately upon staff confirmation (cash can't "fail" asynchronously), and a linked `CashTransaction` for drawer reconciliation. This multiple-tender-lines-per-check model is standard practice among restaurant POS platforms (Toast, Square, and Micros all model split tender the same way), confirmed as the right approach — no true "single blended transaction" split-tender UX is needed.

## 5. Payment succeeds but the browser disconnects / webhook arrives twice

This is the scenario the spec calls out explicitly and it's handled by one mechanism, not two special cases:

- The "finalize" operation (whether triggered by the frontend's post-confirmation call or by the webhook) is wrapped in `Payment.idempotencyKey` (unique DB constraint) plus `ProcessedWebhookEvent.providerEventId` (unique DB constraint) for the webhook path specifically.
- Before doing any writes, the handler checks: is there already a `Payment` row for this `idempotencyKey` in a terminal success state? If yes, it's a no-op that returns the existing result. This means: browser disconnects after Stripe confirms but before our frontend call lands → the later-arriving webhook finalizes it exactly once. Frontend call *and* webhook both arrive → whichever gets the row lock first finalizes, the second sees it's already done and no-ops. Webhook delivered twice (Stripe's documented at-least-once behavior) → `ProcessedWebhookEvent` unique constraint rejects the duplicate before any business logic runs.
- Webhook signature verification (`Stripe-Signature` header, verified against the raw request body using the webhook signing secret) happens before anything else, rejecting unsigned/forged requests — this is also what prevents replay-style abuse of the webhook endpoint as an attack surface.

## 6. Automatic tab settlement

Trigger: configurable per location, default = showtime `endsAt` (computed per DATA_MODEL.md's runtime-based scheduling — the movie's actual end, through credits) + a short grace period (default 5 minutes), evaluated by a scheduled job, not by a customer action. This window is deliberately tight: the tab must be fully settled before the location's `cleaningBufferMinutes` (default 15) is needed for the next showtime's turnover, so settlement failures need fast staff visibility rather than a leisurely retry cadence.

Job logic per eligible `RestaurantTab` (`status = OPEN`, `autoSettleAuthorized = true`, `now() > autoSettleAt`):

1. Lock the tab row; re-check it's still `OPEN` (not already `CLOSED`/`SETTLEMENT_PENDING` from a manual pay that happened in the meantime) — this is the guard against the "customer manually pays right as the auto-job fires" race.
2. Transition to `SETTLEMENT_PENDING`.
3. Compute subtotal from `RestaurantOrderItem`s (excluding voided/canceled). Tip is calculated against this pre-tax, pre-service-charge subtotal (matching RESTAURANT_WORKFLOW.md §7), using the customer's prior live-tab selection if one was made; if the customer never opened the live tab, tip defaults to the location's configured auto-settlement tip policy (see OPEN_QUESTIONS.md — the system never invents a tip amount beyond that configured default). `TaxRule`s and any `ServiceChargeRule`s are then applied to the subtotal per their own configured base. Final total = subtotal + tax + service charge + tip, all itemized separately on the receipt.
4. Attempt `confirmOffSession` against the authorized `PaymentMethodReference`, using an idempotency key derived from `(tabId, settlementCycle)` so a retried job run cannot double-charge.
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

## 10. What this document explicitly does not claim

This design minimizes PCI scope and follows Stripe's recommended integration patterns, but **the application does not become "PCI compliant" merely by using a tokenized processor** — compliance also depends on infrastructure hardening, organizational policies, and a completed SAQ, which are operational/compliance activities outside this codebase's scope. See SECURITY.md §2.
