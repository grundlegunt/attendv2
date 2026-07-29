# Attend — Company Profile

Status: Reference summary — synthesizes PRODUCT_SPEC.md, COMPETITIVE_LANDSCAPE.md, SALES_TARGETS.md, IMPLEMENTATION_PLAN.md, and OPEN_QUESTIONS.md into one overview. Not a new source of truth — if this ever drifts from those documents, they win.

## What we are

Attend is a ticketing and point-of-sale platform built specifically for independent dine-in movie theaters — venues where every seat doubles as a dinner table. The core idea: **one seat, one ticket, one running tab**, from the moment someone buys a movie ticket to the moment they tip and pay for their food, without ever re-identifying themselves to a server. Reserved-seat ticketing and restaurant POS aren't two systems that sync — they're one system, because a seat, a showtime, a ticket, and a tab are all facets of the same underlying record.

This is being built as a real, sellable product from day one, not an internal tool. The founder's own theater is customer #1 — onboarded through the exact same signup path as any other theater customer, with no special-cased shortcuts — and revenue from other theaters is intended to help fund that theater as a real, standalone business (PRODUCT_SPEC.md §1.1).

## What we offer

- **Reserved-seat ticketing** — interactive seat maps, holds with countdown timers, online and box-office sales sharing one live inventory, never two systems that can disagree about whether a seat is sold.
- **Signed QR ticket admission** — tamper-resistant QR codes at issuance, staff scanning (camera or manual entry) that correctly catches reuse, wrong-showtime, and refunded tickets, with a full audit trail of who scanned what and when.
- **Seat-linked dining** — every food/drink order ties to the seat it came from; a customer's tab follows them, servers see "payment on file" the moment they sit down, kitchen/bar get orders routed in real time, and the tab auto-settles near the end of the film if a server never manually drops the check.
- **Full restaurant POS** — server tablet ordering, kitchen/bar displays, menu management, splits/transfers, walk-in bar tabs with no seat or ticket attached (for a standalone bar serving people off the street), and order-ahead concession pickup for theaters without a server floor.
- **Native staff time clock** — PIN-based clock in/out, optional per theater (a theater already happy with 7shifts or Homebase can switch it off entirely). Payroll itself is deliberately not built — hours export to whatever payroll provider a theater already uses, the same scope boundary Vista and Toast both draw.
- **Manager/owner reporting and audit tools** — revenue and admissions by movie, showtime, and date range; refunds/comps; a full audit log for every sensitive action (refunds, price changes, permission changes).
- **Real payments, real merchant-of-record clarity** — Stripe-backed, and each theater's own revenue lands in its own connected account, not pooled through the platform. The theater is the merchant of record for every sale, which keeps sales-tax and (eventually) distributor-settlement obligations exactly where they already legally sit.

## Who it's for

Small, independent dine-in cinemas — operators currently either paying enterprise prices for something built for a twenty-screen chain (Vista), or stitching together two or three disconnected point solutions (a ticketing vendor, a separate POS, a separate scheduling app) the way most real independents actually operate today. Early targets skew toward theaters that are cost-motivated right now — financially distressed dine-in chains, and smaller healthy independents quietly overpaying or juggling too many tools — rather than large chains that are already well served (SALES_TARGETS.md).

## What sets us apart

- **One platform, not a stitched-together stack.** The closest real-world validation of this gap: even Alamo Drafthouse, a major well-resourced chain, had to bring in a third-party BI vendor (Mirus) just to unify their own cinema-ticketing and restaurant-POS data because the two lived in separate systems. Attend answers that at the source, natively, because it was never two systems to begin with.
- **Priced for independents, not enterprise.** Built with AI-assisted development instead of a funded engineering team, which gives it a structurally lower cost basis — the whole basis for undercutting Vista on price while still matching its breadth (ticketing + full POS + native time clock), not just Filmbot's leaner ticketing-only scope.
- **No feature-tier gouging.** The pricing edge is meant to come from being cheap and easy to adopt as one complete product, not from splitting features behind paywalls.
- **Correctness where it actually matters.** Money and seat inventory are treated as non-negotiable from day one — concurrency-safe seat holds (two people can never win the same seat), idempotent payment handling, and audited financial state transitions — even while the rest of the feature surface grows incrementally.
- **Narrow, real integrations instead of a "plug into anything" promise.** Rather than chasing compatibility with every POS a prospective theater might already own (expensive, and works against the cheap/simple pitch), the plan is specific, tractable integrations that matter to this industry — a payroll CSV export, Comscore box-office reporting, a QuickBooks export — matching what a real competitor (Filmbot) actually ships.

## Landscape

| | Ticketing | Restaurant POS | Time clock | Target |
|---|---|---|---|---|
| Vista | Yes | Limited | Native | Large chains |
| Filmbot | Yes | No | No | Small indie theaters |
| **Attend** | Yes | Yes, seat-linked | Native, optional | Small indie theaters |

(Full comparison, including Nitehawk and Toast as additional reference points, in COMPETITIVE_LANDSCAPE.md.)

## How it's structured

Attend is multi-tenant SaaS: `Organization` is the tenant boundary, each theater is one Organization with its own locations, and every theater — including the founder's own — goes through the identical onboarding path. Payments route per-tenant via Stripe Connect so each theater's money reaches its own bank account directly, never pooled through the platform operator.

## Where it stands today, and where it's headed

Milestones 0–4 are built: auth and RBAC, movies/showtimes/seat maps, concurrency-safe seat holds, real Stripe checkout with recovery/idempotency handling for edge cases (failed webhooks, double-clicks, mid-flight failures), and signed QR ticket issuance with staff scanning. Milestone 5 (seat-linked dining tabs) is in progress now.

Ahead, per IMPLEMENTATION_PLAN.md: the rest of the restaurant/POS build-out (Milestones 5–8), box-office POS and staff tooling (Milestone 9), management/reporting/audit tools (Milestone 10), and security/observability hardening (Milestone 11).

Beyond the current milestone roadmap, active research/expansion threads include:

- A cinema **programming & scheduling workspace** for building weekly film schedules across auditoriums (PROGRAMMING_AND_SCHEDULING.md).
- A **general-admission ticketing mode** — no seat map, capacity-based — for repertory/arthouse/festival-style venues (COMPETITIVE_LANDSCAPE.md's nonprofit gap analysis).
- **Nonprofit-specific features**: membership tiers with correct tax-deductibility handling, standalone donation flows, grant/board reporting, validated against a real arthouse case study (Belcourt Theatre).
- **Industry box-office reporting and distributor settlement**: Comscore integration and film-rental/settlement calculations, currently at the pre-implementation-assessment stage (OPEN_QUESTIONS.md §1.1a).
