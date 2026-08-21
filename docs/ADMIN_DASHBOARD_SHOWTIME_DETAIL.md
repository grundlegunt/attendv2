# Admin Dashboard & Selected-Showtime Detail

Live feedback after using the current Admin dashboard and schedule.

## 1. Selected-showtime seat inventory should be a popup, not always-on

Clicking a showtime today opens a detail panel with the full seat inventory grid
permanently expanded — takes up too much vertical space for something you don't
always need to see. Make the seat inventory its own click-to-open popup/modal
within the showtime detail panel, not rendered inline by default.

## 2. Condense the selected-showtime panel, move it to the right

Model this on the earlier reference prototype (`attend-cinema-platform.vercel.app`
— visual reference only, see `docs/PROGRAMMING_AND_SCHEDULING.md`): a compact
panel docked on the right side of the schedule (date/time, room, poster + title,
move-to-room, sale status, key fields) instead of the current large modal that
takes over the center of the screen. The seat-inventory popup from item 1 opens
from within this condensed panel.

## 3. Top Performing Films — hover to preview seat map, click through to revenue

On the dashboard's "Top performing films" list, hovering a film should show a
preview of its current seat map (reuse the existing seat-inventory view). Clicking
should navigate to the revenue report, scoped/filtered to that film.

## 4. Seat map view is missing sales history for past showings

Confirmed gap: there's currently no way to look at a *past* showing's seat map to
see which seats sold. The seat-inventory view needs to work for already-completed
showtimes too, not just current/upcoming ones — this is real sales history, not a
live-operations tool exclusively.

## 5. Dashboard layout: dead space between Cinema Setup and Quick Actions

The right-column "Cinema setup / Readiness" card and "Quick actions" card leave a
visible gap between them. Move Quick Actions up to close the gap, or otherwise
tighten the right-column layout so it isn't leaving unused vertical space.

## 6. Bug: a showtime with real ticket sales isn't appearing on today's Daily Schedule

Reproduced: "The Wedding Singer" shows as the #1 top-performing film today (4
tickets, $68.00 — confirmed real sales on the dashboard) and is visible on the
*customer-facing* showtimes page for today. It does not appear in the Daily
Schedule grid in Admin for today. A showtime with confirmed real sales
disappearing from the operational schedule view is a real bug, not a display
preference — reproduce and find why (possible relation to the earlier
"Preserve past schedule days" fix from `docs/POST_MILESTONE_EDIT_LIST.md` — that
fixed whole past *days* disappearing; this looks like an individual showtime
within *today* being dropped, which may be a related but distinct case worth
checking against the same logic).

## Guardrails

- Item 1 and 2 are a real layout restructure — don't just add a toggle to the
  existing always-on grid, actually move it into a proper popup/modal pattern.
- Item 4 needs the seat-inventory component to accept a past showtime's data, not
  just live/future state — confirm nothing about the current implementation
  assumes a showtime hasn't happened yet.
- Item 6 should be reproduced and root-caused before assuming it's the same bug as
  the past-schedule-days fix — confirm rather than assume they share a cause.
