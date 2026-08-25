CREATE TABLE "film_catalog_entries" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "synopsis" TEXT,
  "runtimeMinutes" INTEGER NOT NULL,
  "rating" TEXT,
  "releaseYear" INTEGER,
  "director" TEXT,
  "starring" TEXT,
  "posterUrl" TEXT,
  "detailPosterUrl" TEXT,
  "trailerUrl" TEXT,
  "primaryDistributorName" TEXT,
  "imdbId" TEXT,
  "tmdbId" INTEGER,
  "eidrId" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "film_catalog_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "film_catalog_entries_imdbId_key" ON "film_catalog_entries"("imdbId");
CREATE UNIQUE INDEX "film_catalog_entries_tmdbId_key" ON "film_catalog_entries"("tmdbId");
CREATE UNIQUE INDEX "film_catalog_entries_eidrId_key" ON "film_catalog_entries"("eidrId");
CREATE INDEX "film_catalog_entries_title_releaseYear_idx" ON "film_catalog_entries"("title", "releaseYear");
CREATE INDEX "film_catalog_entries_active_verified_title_idx" ON "film_catalog_entries"("active", "verified", "title");

ALTER TABLE "movies" ADD COLUMN "catalogEntryId" TEXT;
CREATE INDEX "movies_catalogEntryId_idx" ON "movies"("catalogEntryId");
ALTER TABLE "movies" ADD CONSTRAINT "movies_catalogEntryId_fkey"
  FOREIGN KEY ("catalogEntryId") REFERENCES "film_catalog_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
