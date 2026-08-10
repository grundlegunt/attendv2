ALTER TABLE "film_series"
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "film_series_organizationId_active_sortOrder_idx"
  ON "film_series"("organizationId", "active", "sortOrder");

DROP INDEX "film_series_organizationId_active_idx";

WITH ranked_series AS (
  SELECT "id", CAST(ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "name" ASC) - 1 AS INTEGER) AS position
  FROM "film_series"
)
UPDATE "film_series" AS series
SET "sortOrder" = ranked_series.position
FROM ranked_series
WHERE series."id" = ranked_series."id";

UPDATE "locations"
SET
  "adminAccentMutedColor" = '#8a6500',
  "adminBackgroundColor" = '#000000',
  "adminSurfaceColor" = '#1b1b1b',
  "adminTextColor" = '#ffffff',
  "adminMutedTextColor" = '#cccccc'
WHERE LOWER(COALESCE("adminAccentColor", '')) = '#ffb800'
  AND LOWER(COALESCE("adminAccentMutedColor", '')) = '#ffb800'
  AND LOWER(COALESCE("adminBackgroundColor", '')) = '#ffb800'
  AND LOWER(COALESCE("adminSurfaceColor", '')) = '#ffb800'
  AND LOWER(COALESCE("adminTextColor", '')) = '#ffb800'
  AND LOWER(COALESCE("adminMutedTextColor", '')) = '#ffb800';
