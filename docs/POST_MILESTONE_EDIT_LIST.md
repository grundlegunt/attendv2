# Attend — Post-Milestone Edit List

Compiled from direct product feedback given across planning conversations. Two
parts: the owner's own list (verbatim scope, lightly organized), and a set of items
discussed earlier that never made it onto that list and haven't been built — added
here so nothing gets dropped.

**Sequencing: do not start on anything in this doc until Milestone 11 is complete.**
This is deliberately queued behind it, not parallel work — finish Milestone 11
first, then come back to this list.

Nothing in this doc has been scoped into engineering tasks yet. Triage it — some of
these are one-line bug fixes, some are genuinely large features — before starting.

## Part 1 — Admin

### Master vs. Admin boundary

- Theater layout (the auditorium/seat map builder) should be created through Master
  instead of Admin.
- **Branding is already in Master** — draft/publish workflow for customer-facing and
  admin-facing color palette, logo, and admin UI settings already exists there
  (`docs/ATTEND_MASTER_PLATFORM_ADMIN.md`, Content Studio / branding routes). Nothing
  further needed here.
- Admin should control customer-facing site basics (logo, copy). Master should
  control bigger-picture theater issues. Match this split when moving theater layout
  into Master — don't make Master carry things an individual client should self-serve.
- You should be able to access the customer site directly from Admin (a link out),
  not just find it separately.

### Different Admin product versions per client

Attend currently has one Admin experience: full reserved-seating + POS, built for a
theater like Meridian. Need a second, lighter version for clients that don't reserve
seats — GA (or tiered) ticketing, non-movie-theater, event/concert clients.

This overlaps directly with two things already written up and intentionally not yet
built, both worth reading before scoping this:
- General-admission ticketing itself doesn't exist in the data model yet — every
  ticket is tied to a specific seat via `ShowtimeSeat`. Codex's own status report
  lists this under "longer-term, deferred until a real customer" — it's real work,
  not a UI toggle.
- `docs/ATTEND_MASTER_CLIENT_VERTICAL.md` (PR #242) scoped the client-type question
  and recommended starting with a simple classification label on the client record,
  not a full non-cinema product build, since there's no real non-cinema client to
  build against yet. A second Admin variant is the "build B" side of that doc —
  worth revisiting together with whoever ends up being that first GA-shaped client.

### Showtime seat visibility

- Clicking a showtime in Admin should show the theater layout and which seats have
  already been purchased.
- Theaters that don't reserve seats need the equivalent view without seats — just a
  running count of tickets sold against a per-showtime capacity.

### Theater builder

- Needs to be simplified. (Note: the theater layout builder was previously expanded
  significantly per `docs/ADVANCED_THEATER_LAYOUT_BUILDER.md` to cover multi-aisle
  rows, stadium tiering, seating groups, and templates — this ask is about usability
  of that expanded builder, not reverting the feature set.)

### Reporting

- Admin needs a reporting element for reporting movie tickets back to the
  distributor.

### Navigation / side panel

- Rework the side panel so each category is clearly labeled with what's actually
  inside it.

### Sign-in page

- Needs visual cleanup, and the color scheme should match the client's branding —
  or alternatively, use one standard sign-in page for everyone, with the client's
  color scheme only kicking in once they're logged in. Needs a decision on which
  approach, then implementation.

### Scheduling

- Draft schedules before publishing — e.g., a cinema deciding between 2-3 possible
  movies should be able to draft multiple versions of what a week might look like
  before committing to one.
- Bug: the Clear button on scheduling doesn't work.
- Bug: showtimes for days that have already passed disappear from view — full past
  days should remain visible.
- Needs undo.
- General responsiveness: scheduling moves too slowly.

## Part 2 — Customer site

- Too much dead space throughout the layout.
- Pictures need to be croppable/movable (positioning control), not just swapped.
- Dining tab: the menu should look like an actual menu (real layout/design), not a
  plain list of words. Support uploading a document or image for it.
- Specials should use the same pictures shown on the movie's own detail page/tab —
  not the generic movie poster.
- The Afterglow bar should be listed at the top of the relevant page and clickable
  through to its own page.
- Need control over font type and size for everything — current Master branding
  controls are too limited for this.
- Showtimes page: show 2 movies per line instead of 3.
- Bug: the date header at the top of the showtimes page doesn't update when a
  different date is picked from the calendar. Example: today is August 13, picking
  September 5 correctly shows September 5's showtimes, but the date labels at the
  top still read Aug 13/14/15.

## Part 3 — Discussed earlier, not on the list above, not yet built

Surfaced by cross-checking the two lists above and Codex's own completed-work
report against everything discussed in prior planning conversations. Included here
so these don't quietly fall off the radar just because they weren't top of mind when
the list above was written.

1. **Film series aren't referenced on the showtimes listing itself.** Early
   direction was that any film that's part of a series should say so right on its
   showtime listing, matching Nitehawk's pattern — confirmed via a fresh check of
   `apps/customer-web/app/showtimes/page.tsx`, there's no film-series reference
   anywhere in that file. The film series pages themselves are built; this specific
   cross-reference back onto the main showtimes list never was.
2. **No automated cross-tenant isolation test.** From `docs/ATTEND_MASTER_AUDIT_RESPONSE.md`
   (PR #236) — the tenant-scoping pattern looks correct on inspection, but there's no
   test in `apps/api/test` that actively tries a cross-tenant data grab and asserts
   it's rejected. Cheapest, highest-value item in that whole doc; no dependencies.
3. **Suspension only has one mode.** Also from PR #236 — today `Organization.active = false`
   turns everything off at once (customer site, staff login). Worth a decision on
   whether a softer mode (e.g., admin read-only, customer site still live) is ever
   needed, separate from actually building one.
4. **Internal Attend staff roles are thin.** Two permissions (`platform:write`,
   `platform:team`) across three fixed roles. Fine with one or two Attend employees
   using Master; becomes a real gap the moment platform access is granted more
   broadly without full trust.
5. **Undecided: should Attend's own platform actions ever show up in a client's own
   audit log?** E.g., "Attend Support issued refund #1234." Right now platform
   actions are entirely invisible to the client — not a considered "no," just never
   decided.
6. **Client vertical/business-type classification label.** `docs/ATTEND_MASTER_CLIENT_VERTICAL.md`
   (PR #242) — the small, cheap version (tag a client's type on the record itself,
   for Master's own bookkeeping) hasn't been built yet.
7. **Promotions Phase 3 (marketing email) and Phase 4 (A/B measurement, control
   groups, post-purchase attribution).** From `docs/PROMOTIONS_AND_CAMPAIGNS.md`.
   Customer recency segmentation (Phase 2) is done. Sending an actual campaign and
   measuring it remain blocked on a decision that was never made: which email
   provider to use for bulk marketing send (separate from the existing transactional
   email setup), and what the marketing-consent/opt-in model looks like.
8. **"Just Announced" and a named festival/event page.** From
   `docs/CUSTOMER_WEB_NAVIGATION.md`. Needs a decision — reuse the existing
   `FilmSeries` concept, or introduce a distinct "collection/event" concept — never
   made.
9. **Merch and Open Captions nav links.** Same doc. Merch is presumably a simple
   external link or static page; Open Captions would need a real schema field (a
   screening accessibility/format attribute) before it's a functioning filter rather
   than a label with nothing behind it. Lower priority than the rest of this list.

## Guardrails

- Triage before building: several items above are one-line bugs (scheduling Clear
  button, the showtimes date-header bug, past days disappearing), others are large
  features (a second Admin product variant, draft schedules, GA ticketing). Don't
  treat them as equal-sized work.
- Where this doc points at an existing doc/PR (film series, PR #236, PR #242,
  promotions), read that doc first rather than re-deriving the same analysis from
  scratch.
- The "different Admin version for GA/non-cinema clients" item should not turn into
  a silent decision to build full GA ticketing — that's real, separate, and
  intentionally scoped only once there's an actual client who needs it.
