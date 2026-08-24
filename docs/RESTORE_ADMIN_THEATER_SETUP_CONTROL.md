# Restore Full Theater Setup Control to Admin

## Decision, reversing an earlier one

Earlier direction was "theater layout should be created through Master instead of
Admin" (`docs/POST_MILESTONE_EDIT_LIST.md`). That's been implemented — confirmed
in `apps/admin/app/cinema-setup/page.tsx`, which now shows: *"MANAGED IN ATTEND
MASTER — Theater structure is read-only here"*, with only a read-only detail view
left in Admin.

That was a mistake — reverse it. Admin should have full control over theater setup
again: create, edit, and deactivate auditoriums directly from Admin, not just view
them.

## Why, concretely

Since that change shipped, real gaps have turned up specifically in Master's
version of the builder that Admin's full builder doesn't have:

- Master's builder has no way to set paired/shared-table seating at all —
  hardcoded to single seats only (`docs/MASTER_SEATING_STYLE_MISSING.md`).
- Master's builder let a real auditorium creation fail with an opaque validation
  error because it doesn't enforce the same minimums Admin's builder does
  (`docs/MASTER_AUDITORIUM_BUILDER_VALIDATION.md`).

Master's builder is a simplified subset of Admin's `auditorium-builder.tsx`, not a
full replacement for it. Making Admin read-only meant the *only* place a cinema
could fully configure its own theaters is the less-capable version.

## What to do

- Restore full create/edit/deactivate capability to `apps/admin/app/cinema-setup`,
  using the existing `apps/admin/app/auditorium-builder.tsx` (already has the full
  feature set — advanced mode, seating styles, templates) rather than rebuilding
  anything.
- Keep Master's ability to view and edit theaters too — this isn't about removing
  Master's access, it's about Admin no longer being locked out of its own theater
  configuration. Both should work; neither should be the only option.
- No schema or API changes needed — the create/update auditorium endpoints Admin
  already calls (`/cinema/auditoriums`) still exist and work; this is about
  un-hiding the write UI in Admin, not building new backend capability.

## Guardrails

- Don't remove Master's auditorium builder while doing this — just stop treating
  Admin's as inferior/deprecated. Both stay.
- If Master's and Admin's builders drift in what they support again in the future,
  that's the same underlying problem resurfacing — worth keeping them at parity
  rather than letting one become the "real" one and the other a stripped-down copy.
