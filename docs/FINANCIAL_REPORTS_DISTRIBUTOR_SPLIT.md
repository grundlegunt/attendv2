# Financial Reports — Distributor Split and Ticket Fee Drill-Down

## Distributor vs. cinema revenue

Asked: where does Revenue Overview show distributor revenue vs. cinema revenue?
Checked directly — nowhere yet, but the underlying data already exists and isn't
being used. `Movie` already has `distributorName` and `distributorTerms` (Json),
fully wired through create/update (`apps/api/src/cinema/cinema.service.ts`). What's
missing is `apps/api/src/reporting/reporting.service.ts` actually computing a
distributor/cinema split from those terms — the deal terms are captured, the math
just isn't run anywhere.

**What to add:**

- A "Distributor revenue" box on Revenue Overview, cross-film total for the
  selected range.
- Clicking it opens a detail view: revenue by film, and revenue by distributor
  (a given distributor may have multiple films in the range).
- The existing "By movie" table gets two more columns: distributor amount and
  cinema amount, computed from that film's `distributorTerms` against its ticket
  revenue for the range (alongside the tickets/face-value/F&B columns already
  there).
- `distributorTerms` is a loosely-typed JSON field today — confirm what shape it's
  actually populated with in practice (flat percentage? tiered by week? a
  minimum guarantee?) before writing the split calculation, rather than assuming a
  simple flat-percentage model.

## Ticket fee drill-down

Separately: clicking the ticket-fees figure should open a page showing tickets
sold, the fee amount, and **fee to each party** — i.e., the Attend/cinema split on
the per-ticket fee itself. Confirmed this split doesn't exist as a modeled concept
anywhere — today's flat `ticketFeeMinor` is effectively 100% Attend's revenue,
matching what's already noted in `docs/ATTEND_MASTER_CLIENT_DASHBOARD.md`. If
there's ever a real percentage split between Attend and the cinema on this fee,
that's the same still-undecided billing-model question from
`docs/ATTEND_MASTER_AUDIT_RESPONSE.md` — don't invent a split ratio to satisfy this
page. Build the drill-down page showing tickets sold and total fee collected now;
add the party-split column once (if) that billing decision is actually made.

## Guardrails

- Don't build a generic "revenue splitting" system — this is specifically about
  the distributor deal already captured per movie, and the Attend/cinema fee split
  is a distinct, currently-undecided question. Keep them separate in the UI and in
  the code, even though both show up as "who gets what" questions on the same
  page.
- Reuse the existing `revenue()` report's range/location scoping rather than
  building a parallel reporting path.
