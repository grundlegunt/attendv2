# Attend — Promotions and Win-Back Campaigns

## Why this matters

Filmbot (a named competitor — see `docs/PRODUCT_SPEC.md` §1.1) ran a documented A/B win-back campaign for Nitehawk Cinema (Feb–Mar 2024): a 2-for-1 promo code emailed to 1,500 customers who hadn't attended in 12+ months, measured against a 1,500-customer control group that received nothing. Results: the targeted group returned at 2x the rate of the control group, and spent 75% more in total revenue (ticket + food & beverage combined) over the test period. 60% of code users said they wouldn't have bought without it — i.e., mostly incremental revenue, not cannibalized sales.

This is good evidence that targeted win-back promotions are a real, high-leverage lever for a dine-in independent cinema. Attend's current Promotions feature is far short of what this campaign required.

## Phase 1 — Finish the existing Promotions feature

No new infrastructure needed — the schema already supports all of this, it just isn't reachable from the admin UI:

- Expose `PERCENTAGE` and `COMP` promotion types in the admin form. The `Promotion` model already supports `FIXED_AMOUNT`/`PERCENTAGE`/`COMP` (`PromotionType` in `packages/database/prisma/schema.prisma`), but the admin form hardcodes every new promotion to `FIXED_AMOUNT` only.
- Expose the `startsAt`/`endsAt` expiration fields in the form — also schema-supported, not in the UI. (A 2-for-1-style offer like Filmbot's is effectively a `PERCENTAGE` or `COMP` type with a 30-day expiration.)
- Add edit and deactivate for a promotion. There is currently no `PATCH`/`DELETE` endpoint or UI control at all — a promotion can only be created, never turned off or changed.
- Add redemption reporting: aggregate ticket count and revenue by `promotionId` in `ReportingService`. The link already exists (`TicketOrder.promotionId`), it's just never queried or surfaced. Show it on the reports page — how many times a code was used and how much revenue it drove, mirroring the ticket-revenue/refund reporting that already exists.

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
- Phase 1 is pure UI + reporting work on top of what already exists and can start immediately.
- Phases 2–4 should not begin until Phase 1 is done and the Phase 3 provider/consent questions are actually answered — don't infer an email provider or a consent model on your own.
