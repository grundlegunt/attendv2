# Attend — Movie Metadata in the Admin UI

## Problem

The customer-facing movie detail page (`apps/customer-web`) displays a poster, rating, and synopsis. The `Movie` model in `packages/database/prisma/schema.prisma` already has the columns for all of it:

```
title          String
synopsis       String?
runtimeMinutes Int
rating         String?
posterUrl      String?
```

But the admin "Add a film" form (`apps/admin/app/page.tsx`) only collects `title` and `runtimeMinutes`. There is no way for an operator to set a poster, rating, or synopsis today — the only place those values currently come from is `packages/database/prisma/seed.ts`, where they're hardcoded for the demo movies (`F1`, `Eddington`, `Materialists`, `Ghostbusters`, `The Wedding Singer`), pointing at static files checked into `apps/customer-web/public/posters/`.

## What's already wired up, and what isn't

**Already supports it, no changes needed:**

- `createMovieRequestSchema` in `packages/shared/src/cinema-schemas.ts` already validates `synopsis`, `rating`, and `posterUrl` as optional fields.
- `CinemaService.createMovie` (`apps/api/src/cinema/cinema.service.ts`) already persists all three if they're present on the request body.

So creating a movie with this metadata already works end to end from the API's perspective — the admin form just never sends it.

**Missing entirely — there is no edit path for movies:**

- `updateMovieRequestSchema` already exists in `packages/shared/src/cinema-schemas.ts` but is dead code — nothing imports or uses it.
- There is no `PATCH /cinema/movies/:id` route in `apps/api/src/cinema/cinema.controller.ts` (compare to `PATCH /cinema/showtimes/:id`, which does exist) and no corresponding `CinemaService` method.
- The admin UI has no way to edit a movie once created (unlike showtimes, which have a full edit drawer already).

## What to implement

1. **Add the missing fields to the "Add a film" editor** in `apps/admin/app/page.tsx` (both the drawer form and the collapsed "Cinema setup" panel use the same `createMovie` handler): `Synopsis` (textarea), `Rating` (text input, e.g. `PG-13`), `Poster URL` (text input). Wire them into the existing `POST /cinema/movies` call — no API changes needed for creation.
2. **Add movie editing**, mirroring the existing showtime edit pattern:
   - Wire up `PATCH /cinema/movies/:id` in `cinema.controller.ts` using the already-defined `updateMovieRequestSchema`.
   - Add the corresponding `CinemaService.updateMovie` method.
   - Add an edit affordance in the admin film library (the film cards in `scheduling-calendar.tsx` currently only support drag-to-schedule; add a way to open the existing film for editing, e.g. a click/edit icon).
3. **Poster field is a URL input, not a file upload.** There is no file-storage/blob infrastructure anywhere in this codebase today (checked: no S3, Vercel Blob, Cloudinary, multer, or `FileInterceptor` usage anywhere). Building real image upload means picking a storage provider first — that's a separate decision, not something to improvise inside this task. Keep `posterUrl` as a plain URL text field for now (operators can host a poster anywhere and paste the link, same as the seeded data does with local `/posters/*.png` paths). Do not add file upload as part of this task.

## Guardrails

- Do not change the `Movie` schema — `synopsis`, `rating`, and `posterUrl` already exist as columns.
- Do not build any file-storage/upload pipeline as part of this task; a plain URL field is the correct scope for now.
- Preserve the existing "Add a film" flow for operators who don't care about metadata — title and runtime should remain the only required fields; synopsis/rating/posterUrl stay optional, matching the schema.
- Before changing code, confirm there really is no existing movie-edit path anywhere (e.g., double-check `apps/staff-pos` and `apps/kds` don't already have one) rather than assuming from this doc alone.
