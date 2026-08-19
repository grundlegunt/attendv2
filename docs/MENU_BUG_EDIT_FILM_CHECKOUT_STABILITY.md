# Menu Publish Bug, Edit Film Popout, Film Series Click, Checkout Stability

Four separate items from live testing.

## 1. Bug: published menu image/PDF never reaches the customer site

Confirmed root cause precisely. `apps/admin/app/menu-manager.tsx` has a full,
working "Published menu design" feature — asset type (Image/PDF), URL field, live
preview, a "Publish menu design" button, draft-vs-published state tracking. It
works entirely on the admin side. But `apps/customer-web/app/dining-bar/page.tsx`
never fetches or renders whatever gets published — checked directly, zero
references to the published asset anywhere in that page. An admin can publish a
menu image or PDF and it will never appear for a real customer. This is why it
"doesn't seem to be working" — it isn't, on the read side.

**Fix**: wire the dining-bar page to fetch the published menu asset (whatever API
response `menu-manager.tsx`'s publish action writes to) and render it — the image
or an embedded/linked PDF — ahead of or alongside the structured category/item
grid, matching the intent already stated in the admin copy ("Guests see this
designed menu first; the structured menu remains available as accessible text").

## 2. Edit Film should be a larger popout, not a scrolling side panel

The current film-edit panel (opened from Film Library) is cramped enough to
require scrolling for a single film's fields. Make it a larger modal/popout sized
to fit the fields without scrolling.

## 3. Film series click issue — needs reproduction detail

Reported: unable to click into a film series. Checked
`apps/admin/app/film-series/page.tsx` — Edit, Archive, and Restore actions all
exist and are wired to real handlers, so *something* about series management
works. Given that, this needs more specific reproduction before it can be sized as
a fix: is this about clicking a series row to open a detail/management view (vs.
only the small Edit/Archive/Restore buttons working), or is Edit itself failing
when clicked? Confirm exactly what's clicked and what happens (or doesn't) before
changing anything here.

## 4. Bug: checkout page layout is unstable

Reported as "the page won't stay still" during ticket checkout. No obvious cause
found on inspection of `apps/customer-web/app/components/ticket-checkout.tsx` —
worth noting this is a *different* issue from the timezone/missing-showtime-info
fixes that already landed (PRs #591/#592), which were about wrong/missing
information, not layout movement. Reproduce directly (record which step of
checkout the instability happens at — initial load, after seat selection, during
payment entry, etc.) before attempting a fix; a layout-shift bug without a known
trigger is easy to "fix" in the wrong place.

## Guardrails

- Item 1 is the one confirmed, well-understood bug here — safe to fix directly.
- Items 3 and 4 need reproduction steps from whoever can trigger them live before
  Codex should touch any code — don't guess at a fix for either.
