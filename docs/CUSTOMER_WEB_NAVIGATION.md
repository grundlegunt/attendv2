# Attend — Customer Website Navigation

## Implemented foundation

The customer website now has a persistent top navigation with four deliberately scoped destinations:

- `/showtimes` — the existing now-playing, seat-selection, and checkout journey.
- `/account` — customer sign-in/registration and live restaurant-tab access, moved out of the showtimes page.
- `/directions` — the active cinema's saved name and address, with a link to open turn-by-turn directions.
- `/private-events` — an informational overview that directs guests to contact the cinema; it does not imply an online reservation workflow.

The root route redirects to `/showtimes`. The public now-playing response includes the saved location address so Directions does not depend on hard-coded cinema information.

Coming Soon, Film Series, named festival/event pages, and Open Captions filtering remain deferred until their data-model decisions are made.

## Reference

Nitehawk Cinema's site navigation is the reference point for what a real independent-cinema customer site offers beyond a bare showtime list: Buy Tickets, Coming Soon, Film Series, Dining & Bar, Just Announced, a named festival/event, Merch, Private Events, Directions, Open Captions. Nitehawk presents this as a side menu; for Attend, use a **persistent top nav** instead (matches the existing dark/gold cinematic direction better than a slide-out side panel, and keeps the page's vertical space for the showtime list).

## Current state

`apps/customer-web` is a single page (`apps/customer-web/app/page.tsx`) with no sub-routes at all. The header is just a site name and an "Account" button that toggles a panel in place — there is no navigation to anything else, because nothing else exists yet: no Coming Soon page, no menu/dining page, no directions page, no private-events page.

## What Attend can support today vs. what needs new groundwork

Don't build nav items that point at features the backend has no concept of. Split the reference list into what's realistic now and what needs a real decision first:

**Buildable now, maps to existing data:**

- **Showtimes** (existing default view) — already there, just needs to become a proper nav destination instead of the only thing on the page.
- **Account** — already exists as a toggle panel; promote it to its own route so it can be linked from the nav like everything else, rather than being a special case.
- **Directions** — static content page (location address/hours), no new backend needed. `Location` already has `address` (per `docs/ADMIN_APP_STRUCTURE.md`'s findings, currently not admin-editable — that's a separate, already-tracked gap, not blocking this page).
- **Private Events** — static informational page for now (a contact/inquiry page), no booking system implied.

**Needs a real decision before building, don't improvise it:**

- **Coming Soon.** `Movie` has no release-date or "coming soon" concept at all today — only `title`/`synopsis`/`runtimeMinutes`/`rating`/`posterUrl`/`active`. There's no way to distinguish "this movie has no showtimes yet because it hasn't opened" from any other reason a movie might have zero showtimes. Building this page means first deciding how "coming soon" is represented (a release date field? an explicit status enum?) — that's a schema decision, flag it rather than inferring one on your own.
- **Dining & Bar.** Check whether a customer-facing, standalone menu browse page already makes sense given the restaurant ordering flow (`apps/customer-web/app/components/live-restaurant-tab.tsx` is for an active tab, not a browsable menu) — if not, this is "read the existing menu API and render it read-only," which is low-risk, but confirm there isn't already a page for it before adding one.
- **Film Series / Just Announced / a named festival.** None of these map to anything in the data model — there's no concept of a curated grouping or collection of showtimes/movies distinct from the plain movie list. This is a real feature (some kind of `Collection`/`Series` grouping), not a nav-and-filter task. Don't build a fake version of it with hardcoded movie IDs; either scope it as a real feature or leave it out of the first pass.
- **Merch, Open Captions.** Merch is presumably an external link or a simple static page (confirm with the operator before building anything transactional). "Open Captions" on Nitehawk's site is a screening attribute filter — Attend's `Showtime` model has no accessibility/format attribute today, so this would need the same kind of schema work as Coming Soon before it's a real filter rather than a label with nothing behind it.

## Guardrails

- Don't add schema fields or invent data-model concepts (release dates, series groupings, screening attributes) as a side effect of building the nav — those are called out above specifically so they get a real decision, not a drive-by migration.
- The nav itself (persistent top bar, links to whatever pages exist) can and should ship even if only Showtimes/Account/Directions/Private Events are real to start — a nav with fewer links that all work is better than one that links to unbuilt pages.
- Keep the existing dark background / gold accent / serif-headline visual language already established in `apps/customer-web` and described in `docs/PRODUCT_SPEC.md` §8 — this is a navigation and information-architecture change, not a redesign.
