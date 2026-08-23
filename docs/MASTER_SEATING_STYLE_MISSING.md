# Attend Master — Auditorium Builder Can't Create Paired/Shared-Table Seating

## The gap

Master's quick-build "Layout Designer" (`apps/platform-admin/app/clients/clients-page.tsx`)
only ever produces single seats — no way to set up paired or shared-table seating
(the style visible on both Meridian's own real seat maps and Nitehawk's, where two
seats are grouped as one shared unit with left/right halves). Confirmed root
cause: `auditoriumLayout()` in that file hardcodes `seatingStyle: "SINGLE"` with no
UI control to change it.

This is the same underlying gap already flagged in
`docs/MASTER_AUDITORIUM_BUILDER_VALIDATION.md` — Master's builder being a
simplified subset of Admin's, missing capability Admin already has. Confirmed:
`apps/admin/app/auditorium-builder.tsx` already has a real seating-style selector
wired to the same `SeatMapLayout["seatingStyle"]` field, with **Pairs** and
**Love seat** among the options — this isn't a new concept to build, it's an
existing capability Admin has that Master's quick-build tool never exposes.

## What to add

Add a seating-style control to Master's Layout Designer, same field
(`seatingStyle`), same options already defined in the shared schema
(`SINGLE`/`PAIR`/`LOVESEAT`/`TABLE_2`/`TABLE_4`/`BENCH` — `packages/shared/src/cinema-schemas.ts`).
Reuse Admin's existing selector as the reference for which options make sense to
surface, rather than re-deciding the option set from scratch.

## Guardrails

- Don't reimplement paired-seat rendering or numbering logic — it already exists
  and works (confirmed rendering correctly on both the seed data's own seat maps
  and the reference sites). This is specifically about exposing the existing
  `seatingStyle` field in Master's simplified builder, not building the underlying
  capability.
- Worth checking whether other real differences exist between Master's quick-build
  tool and Admin's full builder beyond this one and the validation-minimums gap
  from the earlier doc — treat this as "Master's builder is a subset, audit it
  properly" rather than fixing gaps one report at a time as they're noticed live.
