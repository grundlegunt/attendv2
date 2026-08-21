# Tax Rules and Ticket Pricing — UX Fixes, and a Real Data Bug

## Priority: the tax rate input is actively producing wrong tax rates

Not cosmetic — this is a live data-integrity bug. Screenshot from testing shows a
real tax rule: **"Sales Tax · 97.5% · FOOD."** A 97.5% sales tax on food is not a
real rate; it's a data-entry mistake, and the input design is what caused it.

Root cause, confirmed in code (`apps/admin/app/management-controls.tsx`): the field
is labeled "Rate in tenths of a percent" and stores `TaxRule.ratePermille` directly
— to enter a real 9.75% rate, an admin has to know to type `97.5`, since the field
wants permille (tenths-of-a-percent) units, not a percentage. Someone typed `975`
expecting to enter "9.75%" as a normal-looking number, and got a rule charging
97.5% instead. This is exactly the "entering the number should be more intuitive"
ask — restated with the concrete harm it already caused.

**Fix**: change the input to accept an actual percentage (e.g., `9.75`), convert to
`ratePermille` internally (× 10) when saving, and convert back for display. Don't
make the admin do unit conversion in their head. Also audit any existing tax rules
for implausible rates (like this 97.5% one) while making the change — a bad rate
entered under the current confusing input may already be live.

## Category selection — checkboxes, so Food + Non-alcoholic can be one rule

`TaxRule.appliesTo` is a single value today (`ALL`/`FOOD`/`ALCOHOL`/`NA_BEVERAGE`)
— confirmed at the schema level, not just the UI. The real-world need described:
sales tax should apply to food and non-alcoholic drinks together, but not alcohol
(which has its own separate tax treatment, e.g., the existing Liquor-by-the-Drink
rules) — and no single existing option expresses "food + non-alcoholic but not
alcohol" (that's narrower than `ALL`, wider than any one category).

**Don't change the schema categories** — `ALL`/`FOOD`/`ALCOHOL`/`NA_BEVERAGE`
already cover the real distinctions. Instead, change the admin UI: let checking
multiple category boxes in one "add tax rule" action create one `TaxRule` row per
checked category (same name/rate, different `appliesTo`) rather than forcing one
rule per category to be added as separate manual steps.

## Editing and removing tax rules

- **Edit**: the API already supports it (`PATCH settings/tax-rules/:ruleId`
  exists and works) — the admin UI just never exposed an edit control, only
  Activate/Deactivate. Add it.
- **Delete**: confirmed no delete endpoint exists at all for tax rules today, only
  deactivation. Think carefully before adding a real destructive delete — a tax
  rule that's already been applied to real historical transactions needs to stay
  intact for accurate past reporting, the same reasoning already applied to
  suspension-vs-deletion elsewhere in this project
  (`docs/ATTEND_MASTER_CLIENT_DASHBOARD.md`'s client-delete section). If "delete"
  really means "remove a rule I created by mistake and never actually used,"
  scope it to rules with zero associated historical charges; anything that's
  actually been applied should stay deactivate-only.

## Layout

- **Admission pricing panel is too small/cramped** relative to the Checkout
  options panel next to it — visible imbalance in the current two-column layout.
  Give it proportionally more room.
- **General ticket-pricing layout needs a pass** — flagged as needing attention
  without a more specific complaint; treat this as "come back and look at this
  page's overall layout," not a specific bug to chase blind.

## Guardrails

- The rate-input fix is the priority item in this doc — it's not a UX polish
  item, it's a bug that can silently overcharge (or undercharge) real customers.
- Don't touch the underlying `RestaurantChargeAppliesTo` categories — the fix for
  multi-category rules is a UI/creation-flow change, not a schema change.
