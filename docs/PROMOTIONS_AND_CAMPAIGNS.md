# Attend — Promotions and Win-Back Campaigns

## Why this matters

Filmbot (a named competitor — see `docs/PRODUCT_SPEC.md` §1.1) ran a documented A/B win-back campaign for Nitehawk Cinema (Feb–Mar 2024): a 2-for-1 promo code emailed to 1,500 customers who hadn't attended in 12+ months, measured against a 1,500-customer control group that received nothing. Results: the targeted group returned at 2x the rate of the control group, and spent 75% more in total revenue (ticket + food & beverage combined) over the test period. 60% of code users said they wouldn't have bought without it — i.e., mostly incremental revenue, not cannibalized sales.

This is good evidence that targeted win-back promotions are a real, high-leverage lever for a dine-in independent cinema. Attend now has the promotion foundation needed for offers like this; segmentation, consent, campaign delivery, and attribution remain separate capabilities.

## Phase 1 — Promotions foundation (implemented)

Implemented:

- `FIXED_AMOUNT`, `PERCENTAGE`, and `COMP` promotion creation in Admin.
- Optional start/end windows, minimum ticket subtotal, and maximum-redemption controls.
- Full promotion editing in Admin, backed by API support for updating every promotion field, plus activation/deactivation controls.
- Per-promotion redemption count, discounted-ticket count, ticket face value, collected revenue, and total discount reporting in Admin.
- Enforcement across customer checkout and box-office quoting, with audited promotion changes.

## Phase 2 — Customer segmentation

New capability, needed before any targeted campaign is possible:

- A way to query customers by purchase recency — e.g., "customers whose most recent ticket purchase was before date X." This can be a report/query over existing `Customer`/`TicketOrder` data; no new schema is needed for this alone.
- An admin screen to build and preview a segment (see the matching customer count) before doing anything with it.

## Phase 3 — Targeted marketing email

This needs a real decision before starting — do not build it silently:

- Attend's existing email sending (Postmark, per `packages/config/src/env.ts`) is for transactional messages only — receipts, confirmations. Bulk marketing email to a segment is a different use case with different deliverability requirements, compliance needs (unsubscribe links, CAN-SPAM), and possibly a different provider or plan. Confirm the approach before assuming the existing transactional setup can just be reused for campaigns.
- Needs a customer-facing marketing-email opt-in/consent concept, since none exists today — nothing in the current `Customer` model distinguishes "will receive transactional receipts" from "opted into marketing email."

## Phase 4 — A/B measurement and post-purchase attribution

Lowest priority, treat as optional: a way to hold out a control group when running a campaign, and a simple post-checkout question like the one Filmbot used ("did this code cause you to buy?"). Real, but not essential to get value from Phases 1–3 — defer unless specifically requested.

## Guardrails

- No changes to ticketing, checkout, or payment architecture.
- Phase 1 is complete and uses the existing promotion and order data rather than a parallel discount system.
- Phases 2–4 should not begin until the Phase 3 provider/consent questions are actually answered — don't infer an email provider or a consent model on your own.
