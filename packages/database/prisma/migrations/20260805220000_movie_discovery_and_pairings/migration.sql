ALTER TABLE "movies"
  ADD COLUMN "director" TEXT,
  ADD COLUMN "starring" TEXT,
  ADD COLUMN "trailerUrl" TEXT,
  ADD COLUMN "releaseYear" INTEGER;

ALTER TABLE "showtimes"
  ADD COLUMN "format" TEXT;

ALTER TABLE "menu_items"
  ADD COLUMN "imageUrl" TEXT;

CREATE TABLE "movie_pairings" (
  "movieId" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movie_pairings_pkey" PRIMARY KEY ("movieId", "menuItemId"),
  CONSTRAINT "movie_pairings_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "movie_pairings_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "movie_pairings_menuItemId_idx" ON "movie_pairings"("menuItemId");

ALTER TABLE "movies"
  ADD CONSTRAINT "movies_releaseYear_check"
  CHECK ("releaseYear" IS NULL OR ("releaseYear" >= 1888 AND "releaseYear" <= 2200));
