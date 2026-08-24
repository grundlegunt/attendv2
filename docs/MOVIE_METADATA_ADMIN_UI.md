# Attend — Movie Metadata in the Admin UI

Status: Implemented and reconciled August 24, 2026.

## Current workflow

Cinema operators manage the film library from Admin's Scheduling route. The same editor supports new films and updates to existing films.

The editor covers:

- title and runtime;
- rating and customer-facing synopsis;
- landscape showtime-card artwork and its focal position;
- vertical movie-detail artwork and its focal position;
- director, cast, trailer URL, and release year;
- an optional dining-special image and promotional name;
- distributor identity and dated distributor-share terms;
- film-to-menu pairings used by customer-facing dining specials.

Artwork previews distinguish the landscape showtime card from the vertical detail poster so an operator can verify both uses before saving.

## API and lifecycle

- Movie creation and updates use the shared cinema request schemas.
- `PATCH /cinema/movies/:id` persists edits through `CinemaService.updateMovie`.
- Film mutations retain stable idempotency keys while an ambiguous request is retried, and the Admin editor serializes conflicting actions.
- Films can be archived and restored. Permanent deletion is a separate guarded operation because scheduled and historical activity may reference a film.
- Public movie and showtime views consume the saved metadata rather than demo-only title matching.

## Artwork decision

Movie artwork remains URL-based. The product supports local public assets and externally hosted image URLs, but it does not currently provide an image-upload or asset-storage pipeline. Selecting a storage provider, upload authorization model, image processing policy, and retention rules is a separate infrastructure decision.

## Guardrails

- Keep title and runtime required; optional editorial metadata must not block a basic film record.
- Validate artwork and trailer URLs through the shared request schema rather than trusting raw client input.
- Keep showtime-card and movie-detail artwork separate; they have different aspect ratios and presentation needs.
- Use the configured focal positions instead of baking one crop into uploaded source artwork.
- Do not rewrite historical distributor calculations when current film terms are edited; terms are date-bounded.
- Archive referenced films instead of deleting them as a routine library action.
- Do not introduce file upload as a side effect of changing the metadata form.
