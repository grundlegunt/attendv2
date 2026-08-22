# Attend Master — Auditorium Builder Validation Bug

## The bug, root-caused

Reported: creating an auditorium for a new client ("Afterglow") in Master fails
with a bare "Request validation failed." Traced precisely, in
`apps/platform-admin/app/clients/clients-page.tsx`:

- The rows / seats-per-row number inputs allow `min="0"` — no client-side floor.
- The shared schema both Admin and Master ultimately validate against
  (`seatMapLayoutSchema`, `packages/shared/src/cinema-schemas.ts`) requires
  `canvas.width` ≥ 12 and `canvas.height` ≥ 8.
- `auditoriumLayout()` computes `canvas.width` as `seatsPerRow + (centerAisle ? 1 : 0)`
  and `canvas.height` as `rows` directly from those unguarded inputs.

Any real auditorium smaller than that — fewer than 8 rows, or few enough seats per
row that width drops under 12 with the aisle included — passes Master's form with
no warning, then gets rejected server-side with a validation error that never
reaches the person filling out the form. This matches the observation that
Master's layout designer "isn't fully functional with all features yet" — it's
missing the same input guardrails Admin's builder presumably already has (or at
minimum needs to gain, since it hits the same shared schema).

## Two fixes, not one

1. **Enforce the real minimums in Master's form itself** — `min="8"` on rows,
   and a seats-per-row minimum that keeps computed canvas width ≥ 12 accounting
   for the aisle toggle (validate this combination, not just each field in
   isolation) — so an invalid auditorium size is caught while someone's typing,
   not after a failed submit.
2. **Surface the actual validation error, not just the generic message.**
   Checked `ZodValidationPipe` (`apps/api/src/common/zod-validation.pipe.ts`) —
   the API already returns a structured `issues` array (field path + message)
   alongside the generic "Request validation failed." text. Master's error
   handling never reads or displays `issues` — confirmed no reference to it
   anywhere in `clients-page.tsx`. Even after fix #1, some validation failure
   will eventually happen for some other reason; when it does, show the specific
   field-level message the API is already providing instead of the bare generic
   string.

## Guardrails

- Don't just raise the input minimums silently — a manager creating a genuinely
  small auditorium (a screening room, a private-event space) needs to understand
  *why* there's a floor, not just hit a wall at 8 rows with no explanation.
- Fix #2 (surfacing `issues`) is generically useful beyond this one form — worth
  applying to Master's error handling broadly, not just the auditorium builder,
  since the same opaque-generic-message problem will recur anywhere else a
  request gets rejected by a Zod schema.
