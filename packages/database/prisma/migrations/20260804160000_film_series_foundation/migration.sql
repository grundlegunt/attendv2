CREATE TABLE "film_series" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "artworkUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "film_series_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "film_series_organizationId_name_key" ON "film_series"("organizationId", "name");
CREATE INDEX "film_series_organizationId_active_idx" ON "film_series"("organizationId", "active");

ALTER TABLE "film_series" ADD CONSTRAINT "film_series_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "film_series" ("id", "organizationId", "name", "updatedAt")
SELECT gen_random_uuid()::text, l."organizationId", btrim(s."filmSeries"), CURRENT_TIMESTAMP
FROM "showtimes" s
JOIN "auditoriums" a ON a."id" = s."auditoriumId"
JOIN "locations" l ON l."id" = a."locationId"
WHERE s."filmSeries" IS NOT NULL AND btrim(s."filmSeries") <> ''
GROUP BY l."organizationId", btrim(s."filmSeries");

ALTER TABLE "showtimes" ADD COLUMN "filmSeriesId" TEXT;

UPDATE "showtimes" s
SET "filmSeriesId" = fs."id"
FROM "auditoriums" a
JOIN "locations" l ON l."id" = a."locationId"
JOIN "film_series" fs ON fs."organizationId" = l."organizationId"
WHERE a."id" = s."auditoriumId" AND fs."name" = btrim(s."filmSeries");

ALTER TABLE "showtimes" DROP COLUMN "filmSeries";
CREATE INDEX "showtimes_filmSeriesId_startsAt_idx" ON "showtimes"("filmSeriesId", "startsAt");
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_filmSeriesId_fkey"
  FOREIGN KEY ("filmSeriesId") REFERENCES "film_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
