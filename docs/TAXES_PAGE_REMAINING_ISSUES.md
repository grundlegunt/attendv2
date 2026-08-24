# Taxes Page — What's Fixed, What's Still Wrong, and a Parallel Bug

## Already fixed, confirmed in code — no action needed

From the earlier tax-rate doc: Tax Rules now accepts a real percentage
(`percentageToPermille()` in `apps/admin/app/lib/tax-rate.ts`, wired into the Tax
Rule form) and category selection is checkboxes producing a multi-category
`appliesTo` array (`setTaxCategory()`). Both landed correctly.

## Still open: no permanent delete for tax rules

Confirmed still true — checked `apps/api/src/management/*.controller.ts`, the
only `@Delete` route in that file is `roles/:roleId`; nothing for tax rules.
Deactivate-only remains the only removal path. Restating the earlier
recommendation since it hasn't been addressed: scope any real delete to rules
with zero historical charges attached; leave anything actually applied to real
transactions deactivate-only, same reasoning as auditorium and client deletion
elsewhere in this project.

## New: Admission Pricing panel — input boxes too narrow, text unreadable

Live screenshot shows the "Admission pricing" panel's Name field rendering
entered values truncated and hard to read — "Standard" shows as "Star",
"Tuesday" shows as "Tue". This is a real, distinct layout bug from the earlier
"admission pricing panel is cramped" note — specifically, the name inputs
themselves are too narrow for their content. Widen them, or wrap/scroll rather
than silently cutting text off — a manager looking at "Star" and "Tue" has no way
to tell what's actually saved without clicking in.

## New: Service Charges has the exact same rate-input problem Tax Rules just had

Confirmed: `management-controls.tsx`, the Service Charges form (`charge.appliesTo`
/ `charge.ratePermille`, distinct from the Tax Rules form) still shows "Rate in
tenths of a percent" and still stores/edits the raw permille value directly — the
identical pattern that caused the real 97.5%-tax-rate data bug in Tax Rules,
un-fixed here. Apply the same fix (`percentageToPermille`-style conversion, a
real-percentage input) to Service Charges, not just Tax Rules — it's the same bug
in a sibling form that didn't get touched.

## Guardrails

- Don't re-touch the Tax Rules rate input or category checkboxes — both are
  correct as shipped.
- The Service Charges fix should reuse the exact same `percentageToPermille`
  helper already written for Tax Rules, not a second implementation of the same
  conversion.
