# Admin & Master — Efficiency Suggestions

Five suggestions from reviewing the current Admin/Master experience end to end,
not from a specific reported bug or a competitor comparison. Forward-looking —
triage against the rest of the backlog rather than treating this as urgent.

## 1. Global search across Admin

Today, finding a specific order, customer, ticket, or gift card means knowing
which page it lives on. A manager on the phone with a customer ("my card was
charged twice for tonight's 7pm") shouldn't have to check Refunds, then Reports,
then Reprint/Reissue separately. One search bar — order ID, customer email/name,
ticket ID, gift card code — surfacing results across all of those would save real
time on exactly the kind of call that happens constantly at a real theater.

## 2. Consolidate "needs attention" into one view

Pieces of this already exist independently: the dashboard already tags
low-selling showtimes ("LOW SALES"), the box-office API already has an
`/attention` endpoint, refunds can sit in manager-review needing follow-up, and
private-event inquiries can go unanswered. These are all the same underlying
concept — "something here needs a human to look at it" — but they live on
different pages today. One consolidated inbox/list, ideally on the dashboard
itself, would surface all of it in one place instead of requiring a manager to
check five separate screens to find out what's actually pending.

## 3. Make the audit log searchable, not just a scrolling feed

Motivating example: the live tax-rate bug found this session (a rule saved as
97.5% instead of 9.75%, `docs/TAX_AND_PRICING_UX.md`) would have been caught in
seconds with a searchable audit log ("who changed the tax rate, and when")
instead of needing direct code investigation to find. The audit trail already
records this kind of change — it just isn't searchable/filterable today. Add
filtering by actor, action type, and date range at minimum.

## 4. Bulk actions on pricing and scheduling

Given how much manual editing already happens in scheduling and pricing (and how
much of this session's feedback was about single-item editing feeling slow), bulk
operations are worth considering once single-item editing is solid: apply a price
change across an entire ticket group at once, edit multiple showtimes in one
action. Sizeable, don't rush it ahead of the fixes already in the backlog — noting
it as a direction worth having on the radar.

## 5. Master: client health signals beyond revenue

Relevant once there's more than one real, live client. Revenue alone doesn't
surface who's struggling — a declining sales trend, an unusually high refund
rate, or repeated failed payments would all be worth flagging proactively on the
Master dashboard rather than only being visible if someone thinks to go looking
for them.

## Guardrails

- None of this is urgent — it's forward-looking, not a response to a specific
  complaint. Triage against the rest of the backlog normally.
- Item 3 is the cheapest and most clearly justified by something that already
  happened this session — worth prioritizing ahead of the other four if only one
  gets picked up soon.
- Item 5 has no real second client to validate it against yet, same caveat as
  everything else in this project gated on "once there's more than one client."
