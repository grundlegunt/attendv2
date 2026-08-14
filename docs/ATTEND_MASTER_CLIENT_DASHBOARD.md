# Attend Master — Client Financial Dashboard, Export, and Delete

Direct feedback after using the current Master dashboard live. Checked each item
against `apps/platform-admin/app/page.tsx`, `apps/platform-admin/app/clients/clients-page.tsx`,
and `apps/api/src/platform/` before writing this, so the "already have this" and
"actually missing" calls below are grounded, not guessed.

## 1. Dashboard: per-client revenue detail with a real date-range toggle

**Partially already there.** The dashboard's revenue panel already shows cross-client
totals (ticket face value, service fees, ticket tax, ticket total collected, F&B
revenue, combined net, refunds) and a per-client breakdown list (ticket collected,
F&B, combined net) linking into each client. What's missing from what was asked for:

- **Range toggle is only Today / Last 7 days.** Need day/week/month/year (and
  probably a custom range) — `revenueRange()` in `apps/platform-admin/app/page.tsx`
  already takes a `days` parameter, so this is extending an existing pattern, not
  building a new one.
- **"Attend revenue" isn't labeled as such.** Today "Service fees" is shown, which —
  since there's no percentage-based fee model, only the flat per-ticket
  `ticketFeeMinor` — is already effectively 100% Attend's revenue. It's just framed
  as "service fees" rather than "what Attend collected." Relabeling this
  appropriately makes sense now. If Attend ever moves to a percentage-of-fee split
  with the client (rather than the client absorbing the full flat fee), that's a
  bigger, separate decision — the same billing-model gap already flagged in
  `docs/ATTEND_MASTER_AUDIT_RESPONSE.md`. Don't build a percentage split as a
  side effect of this — just show what's actually true today under the current
  flat-fee model.
- **Total tickets sold per client isn't shown on the dashboard** — the revenue
  totals object includes `ticketsSold` today only in the cross-client aggregate type,
  not broken out per client in the list. Small addition to the same response.

## 2. Client detail view — full financial + operational dashboard per client

Today, clicking a client mostly gets you editing surfaces (org identity, locations,
auditoriums, branding, content, Stripe Connect status) — real and already built, but
not a financial dashboard. What's being asked for, specifically:

- Ticket sales, gross revenue, and fees paid to Attend — scoped to that one client,
  with the same date-range control as the main dashboard.
- F&B info for that client — explicitly **not a priority to build extensively**,
  since Attend doesn't take a cut of F&B revenue today. Surfacing the existing
  `fnbRevenueCents` figure (already computed, already returned per-client in the
  dashboard's revenue rollup) on the client detail view is enough — don't build new
  F&B-specific reporting infrastructure for this.
- Contact info for the operator, and billing information for the client. Contact
  info is a straightforward addition (a field or two on `Organization` or a related
  contact record). Billing information depends entirely on the still-undecided
  billing/subscription model (`docs/ATTEND_MASTER_AUDIT_RESPONSE.md` — "no
  billing/subscription model in the schema at all"). Don't invent billing fields to
  satisfy this half of the ask; flag it as blocked on that decision.
- All the editing capability already on the client detail view should stay exactly
  where it is — this is additive (a dashboard section alongside existing editors),
  not a replacement.

## 3. Exportable data from Master

No export capability exists anywhere in `apps/platform-admin` today (checked — no
CSV/export endpoints under `/platform/*` in `platform.controller.ts`, unlike
`apps/api/src/reporting/reporting.controller.ts`'s existing
`GET /reports/revenue.csv` and `GET /reports/labor.csv` for cinema-level Admin).
Add the equivalent for Master's cross-client and per-client revenue views, following
that same CSV-export pattern already established in the codebase rather than
inventing a new export mechanism.

## 4. Bug: changing a client's business type after creation has no visible effect

Reported: created a new org, business type showed "Cinema," changed it, and nothing
changed. Checked the code path directly — `businessTypeLabel` is fully wired
end-to-end (schema field, create/update API schemas, service persistence, an
editable field in `clients-page.tsx` with a save path that sends the new value in
the update request). Mechanically, it should persist.

Two different things could be going on, and they need different fixes:

- **If it doesn't actually persist** (edit it, reload the page, it's back to the old
  value) — that's a real save/refresh bug, worth tracing through
  `updateOrganization` in `platform.service.ts` and the client-list refetch after
  save in `clients-page.tsx`.
- **If it does persist, but nothing else changes** — that's expected, current
  behavior, not a bug. `docs/ATTEND_MASTER_CLIENT_VERTICAL.md` deliberately scoped
  this field as a classification label only, with no downstream product behavior
  tied to it, since there's no second, non-cinema client to build real behavior
  against yet. If that's what's actually happening, the fix isn't code — it's
  making sure this is communicated (e.g., inline help text near the field
  explaining it's for Attend's own records right now, not a feature toggle) so it
  doesn't read as broken.

Confirm which of these it actually is before starting on either fix.

## 5. Deleting a client

No delete endpoint exists for organizations — checked `platform.controller.ts`,
the only `@Delete` route under `/platform/organizations/...` is for individual
auditoriums, nothing at the organization level. This is a real gap, and also a
genuinely dangerous one to build carelessly: an organization can have showtimes,
tickets already sold, payment history, and audit records attached to it.

Don't build a hard delete. This should follow the same shape already established for
suspension (`docs/ATTEND_MASTER_AUDIT_RESPONSE.md` — suspension already exists as a
real, non-destructive mechanism) and the offboarding thinking from
`docs/ATTEND_MASTER_PLATFORM_ADMIN.md` — preserve historical/financial records,
don't cascade-delete a client's ticket or payment history. If "delete" really just
means "get rid of a client I created by mistake and never went live," a safe
short-term answer might be: allow deletion only for an organization with zero
real activity (no tickets sold, no payments), and require suspension instead of
deletion for anything with real history. Confirm the actual need (test org cleanup
vs. real offboarding) before deciding which of those to build.

## Guardrails

- Items 1 and 3 are additive to reporting that already exists — cheap, low-risk.
- Item 2's contact-info half is cheap; its billing-info half is blocked on a real
  decision, not a coding task — don't guess at a billing model to unblock it.
- Item 4 needs a quick diagnosis (real bug vs. expected behavior) before any code
  changes — don't guess which one it is.
- Item 5 needs a decision on what "delete" actually needs to mean before building
  anything — a real destructive delete is very likely the wrong answer given what
  organizations carry with them (tickets, payments, audit history).
