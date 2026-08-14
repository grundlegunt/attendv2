# Merch Management, F&B Menu Upload, and an Auditorium Editing Bug

Three unrelated items — a real feature upgrade, a product decision on menu
presentation, and a bug report. Checked each against the current code before
writing.

## 1. Merch — Admin should manage it, not just link to it

Today "merch" is a single external URL field
(`content.navigation.merchUrl` → `apps/customer-web/app/components/site-header.tsx`)
that renders one "Merch ↗" nav link pointing off-site. That's it — no products, no
admin management, confirmed via a repo-wide search for "merch" outside that one
field. The ask now is real merch management from Admin, not just a link.

This is a genuinely new feature, sized similarly to Menu (`apps/admin/app/menu/page.tsx`)
rather than a quick addition — a merch item needs at minimum a name, price, and
image (matching the pattern already used for movie posters, film-series artwork,
and menu items: a plain URL text field, no file-upload infrastructure exists
anywhere in this codebase and this doc doesn't ask for that to change), plus
active/inactive status the way menu items already have.

**Before building a full product catalog, decide how merch actually gets sold**,
since that's a bigger question than the admin UI:

- Is it sold through Attend at all (real checkout, added to `PaymentPurpose` as a
  third purpose alongside `TICKET_ORDER`/`RESTAURANT_TAB`), or is Admin just
  managing a browsable catalog that still links out to an external store per item
  (same as today, just per-product instead of one blanket link)?
- If it's sold through Attend: does it need inventory/quantity tracking (sizes,
  stock levels)? That's the same "Inventory" gap already flagged in
  `docs/VEEZI_FEATURE_COMPARISON.md` as not built anywhere in this codebase.

Don't guess at checkout integration — confirm whether this is "catalog + external
purchase link" (cheap, buildable now) or "real in-app merch sales" (bigger, needs
the payment-purpose and possibly inventory work) before starting.

## 2. F&B menu — let admin upload a link or image, not just structured items

The dining page (`apps/customer-web/app/dining-bar/page.tsx`) already renders the
real structured menu — categories and items with names and prices, not placeholder
text. What's actually missing (already flagged, restated here with the new detail):
individual item photos, since `apps/admin/app/menu/page.tsx` still has no `imageUrl`
field despite `MenuItem.imageUrl` existing in the schema and already being rendered
publicly when present.

New detail from this round of feedback: admin should be able to set the menu
presentation as **either** a link **or** an image — e.g., a cinema that already has
a designed PDF or photo of their physical menu should be able to just point to that,
rather than being forced to re-enter every item into Attend's structured menu system.
Two different things, don't conflate them:

- **Per-item photos** — the already-known gap. Add the `imageUrl` field to
  `apps/admin/app/menu/page.tsx`, plain URL text input, same pattern as movie
  posters elsewhere in Admin.
- **A whole-menu override** (a single link or image standing in for the entire
  structured menu) — a new, separate concept: something like a
  `Location`-level `menuOverrideUrl` (URL text field, same no-upload-infrastructure
  pattern) that, when set, the dining page shows/links to instead of — or in
  addition to — the structured category/item grid. Needs a decision on which:
  does setting it *replace* the structured menu entirely, or sit alongside it as an
  additional "see our full menu" link? Confirm before building — this changes the
  customer-facing page's layout.

## 3. Bug: editing an ADA seat in an existing auditorium doesn't save

Reported: editing where the ADA (wheelchair) seat is positioned in an existing
theater's layout doesn't save. Traced the save path
(`apps/admin/app/auditorium-builder.tsx`, `save()` around line 258) — the PATCH to
`/cinema/auditoriums/:id/layout` does fire and includes the full seat array, so this
isn't an obviously missing code path. Two different explanations are possible, and
they need different fixes — confirm which one is actually happening before
changing anything:

- **Seat map versioning is working as designed, but looks broken.** The save
  handler's own success message says: *"layout version saved. Existing showtimes
  keep their original seats."* This strongly suggests auditorium layout edits
  create a new seat map **version**, and showtimes already scheduled before the
  edit intentionally keep using the seat map version they were created against —
  by design, so historical ticket/seat data doesn't shift under sold tickets. If
  the ADA seat is being checked against an *existing showtime's* seat map (rather
  than the auditorium's current/latest layout), it would correctly still show the
  old position — that's not a bug, but it needs a clear UI signal (e.g., "this
  showtime uses an earlier layout version") so it doesn't read as "my edit didn't
  save."
- **A real save bug**, if the edit doesn't persist even when creating a *new*
  showtime after the edit, or doesn't show up when reopening the auditorium editor
  itself (not a specific showtime's seat map). If that's what's actually happening,
  trace whether the seat-type toggle in the editor UI is actually included in the
  `seats` array sent in the PATCH body, or whether it's being dropped somewhere
  between the UI state and `finalSeats`/`finalLayout` in `save()`.

Reproduce precisely which of these it is (edit → check the auditorium editor itself
vs. edit → check an existing showtime's seat map vs. edit → create a new showtime
and check that) before assuming which fix applies.

## Guardrails

- Item 1 needs a checkout-model decision before building the full catalog; the
  admin-only "catalog with external purchase links" version doesn't need that
  decision and can start now if that's the scope wanted.
- Item 2's two halves (per-item photos vs. whole-menu override) are different
  sized changes — don't bundle them into one task.
- Item 3 needs reproduction before a fix — don't patch the save path blind without
  first confirming whether this is a versioning-by-design situation or an actual bug.
