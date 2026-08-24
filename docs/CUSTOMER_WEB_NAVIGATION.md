# Attend — Customer Website Navigation

Status: Implemented and reconciled August 24, 2026.

## Current navigation

The customer website uses a persistent top navigation across its public routes:

- **Showtimes** — now-playing films, date selection, open-caption filtering, seat selection, and checkout.
- **Coming Soon** — films whose first scheduled showtime is after the cinema's current local date.
- **Just Announced** — the six newest upcoming films, ordered by their movie record creation time.
- **Film Series** — active managed series, artwork, descriptions, assigned films, and future showtimes.
- **Open Captions** — the showtimes program filtered to screenings whose presentation is `OPEN_CAPTIONS`.
- **Dining & Bar** — the published menu presentation plus its accessible structured menu.
- **Account** — customer registration, sign-in, order history, profile controls, and live restaurant-tab access.
- **About** — operator-managed public copy.
- **Merch** — an optional external shop link, shown only when an operator publishes a valid merchandise URL.

Directions and Private Events are also public routes. Private Events includes a persisted customer inquiry flow; it is not a retail reservation or contract workflow. The root route redirects to Showtimes.

## Implementation decisions

Nitehawk Cinema's public navigation was the original reference, but Attend keeps its own persistent top-header treatment and data model.

- Coming Soon is derived from explicitly scheduled future showtimes rather than a separate release-date field. A movie without a future showtime is not presented as coming soon.
- Just Announced reuses that upcoming program and sorts it by movie creation time. It does not infer announcements from titles or hardcoded movie IDs.
- Open Captions is a real screening filter backed by the showtime presentation value; the compact `OC` label uses the same value.
- Film Series uses managed `FilmSeries` records and explicit showtime assignments.
- Merch remains an external link. Attend does not claim to provide general merchandise checkout.
- Dining & Bar publishes both operator-provided presentation artwork and structured text so the menu remains accessible.

## Guardrails

- Keep the editorial links tied to canonical routes and query parameters so the active-navigation state matches the page being displayed.
- Perform date comparisons in the cinema's timezone, not the visitor's device timezone.
- Do not replace explicit film-series or screening-presentation data with title matching.
- Do not show Merch when no validated external URL has been published.
- Preserve the three-column desktop showtime grid and the established cinematic visual language unless a separate product decision changes them.
- Named festivals beyond Film Series, transactional merchandise, and custom private-event contracts remain separate product decisions rather than implied navigation work.
