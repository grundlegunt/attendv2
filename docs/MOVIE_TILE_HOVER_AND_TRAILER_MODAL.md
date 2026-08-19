# Showtimes Cards — Hover State, and an Inline Trailer Modal

Two related asks, checked against the actual code first.

## 1. Hover state on showtimes movie cards

Reference: Nitehawk's showtimes cards, hovered — the poster/still darkens
slightly, a one-line synopsis appears over the image, and Trailer / Details
buttons fade in as semi-transparent overlay pills.

Confirmed: `apps/customer-web/app/components/movie-tile.tsx` has no hover state
at all today — no darken, no synopsis overlay, no button reveal. Add it: on
hover, dim the image slightly, show the movie's existing `synopsis` field as an
overlay line, and reveal Trailer/Details buttons (only render the Trailer button
when `trailerUrl` is actually set, same guard already used elsewhere in the
codebase for that field).

## 2. Trailers should open inline, not navigate away

Confirmed: every existing trailer link in the app
(`apps/customer-web/app/movie/[id]/page.tsx`, `editorial-movie-list.tsx`, and the
new hover buttons from item 1) renders as a plain `<a href={movie.trailerUrl}>`
that navigates the visitor off Attend's site entirely, usually to YouTube. Change
this to open an inline modal/lightbox video player instead — matching the
reference screenshot's in-page popup with a close button — across all three
places `trailerUrl` is used, not just the new hover surface, so the behavior is
consistent site-wide.

**Real implementation detail to handle, not gloss over**: `Movie.trailerUrl` is a
plain admin-entered URL field, not guaranteed to be in an embeddable format. If
it's a standard YouTube watch URL, it needs converting to YouTube's embed URL
format (`youtube.com/embed/VIDEO_ID`) for the modal's iframe. Since admins can
enter *any* URL there, decide what happens for a non-YouTube link: either detect
and support a small set of known embeddable providers (YouTube at minimum;
Vimeo if it comes up in practice) and fall back to opening in a new tab for
anything else, or restrict the field's guidance to YouTube-only if that's
simpler. Don't assume every stored `trailerUrl` is embeddable without a fallback
path — a modal that just shows a broken iframe for an unsupported link is worse
than the current plain link.

## Guardrails

- Don't change how `trailerUrl` is captured in Admin — this is purely about how
  it's presented to customers.
- Keep the fallback (open in a new tab) for any URL the embed logic doesn't
  recognize, rather than failing silently.
