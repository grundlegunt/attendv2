# Two Decisions From Competitive Research — Not Build Tasks Yet

Both items below came out of reviewing a competitor (Cinema Hosting / "PRIME").
Neither is ready to build — each needs a real decision first. Written up so
they're on record, not lost, while that decision gets made.

## 1. Differential service fee: guest checkout vs. registered account

Idea: charge a higher service fee for guest checkout than for a registered,
logged-in customer — both as direct revenue and as an incentive to create an
account (which then feeds email marketing once that's unblocked — see
`docs/PROMOTIONS_AND_CAMPAIGNS.md`).

Confirmed current state: `Organization.ticketFeeMinor` is a single flat fee,
no guest-vs-registered concept anywhere in the schema or checkout flow.

**Needs deciding before scoping a build**: the actual fee amounts for each case,
whether this applies to ticket purchases only or F&B too, and whether it's
disclosed to guests at checkout as a reason to register (transparent) or just a
quiet default (less transparent, worth being deliberate about which).

## 2. Comscore reporting

Idea: report Meridian's real box-office numbers out to Comscore, the industry's
official box-office aggregator — the same numbers distributors use to verify
grosses and calculate film-rental payments. This is external reporting, not
something that changes anything internal — Attend's own distributor-split
reporting (`docs/FINANCIAL_REPORTS_DISTRIBUTOR_SPLIT.md`) already computes the
same kind of split internally; this would be about also sending real numbers to
a third party.

**Needs a real yes/no decision, not inference**: whether Attend/Meridian
actually wants to participate in Comscore reporting at all, and if so, what that
integration requires from Comscore's side (reporting format, cadence,
credentials) — none of that should be guessed at or built speculatively.

## Explicitly declined, recorded so it isn't re-proposed

**No integration with Fandango or MovieTickets.com.** Considered as part of the
same competitive research, explicitly turned down. Noting this so it doesn't
resurface as a suggestion later without something actually changing.

## Guardrails

- Neither item 1 nor item 2 should be scoped into engineering work until the
  specific open questions above are answered — this doc is a decision record,
  not an instruction to build.
