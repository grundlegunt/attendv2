# Movie Specials and Scheduler UX — Shipped

This document records the disposition of the original Movie Specials and
scheduler-interaction brief. Both workstreams are complete.

## Movie Specials on Showtimes

The customer Showtimes page now loads the restaurant menu, matches each active
film to its configured special, and renders those specials beneath the active
date's movie listings. The Dining & Bar page continues to use the same shared menu
response and presentation component.

Admin menu management supports an optional image URL when creating or editing an
item, including an image preview. Movie scheduling also supports dedicated combined
dining-special artwork and warns operators when a configured pairing lacks the
artwork required for public presentation.

## Scheduler placement

The scheduling calendar now provides:

- a single computed drop preview for the resolved auditorium and start time;
- explicit showtime targets for swaps rather than ambiguous DOM overlap;
- time-based swap resolution;
- hover/focus-only remove and duplicate controls with dedicated backgrounds; and
- distinct drag-target and preview styling.

These changes address the original reports of imprecise placement, ghosted drop
states, and controls colliding with showtime titles.

## Status

No remaining implementation work is tracked by this brief. Further scheduler
changes should be driven by new live-use feedback with a reproducible interaction.
