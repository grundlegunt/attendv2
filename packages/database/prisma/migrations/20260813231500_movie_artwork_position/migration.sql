CREATE TYPE "MovieArtworkPosition" AS ENUM ('TOP', 'CENTER', 'BOTTOM');

ALTER TABLE "movies"
ADD COLUMN "posterPosition" "MovieArtworkPosition" NOT NULL DEFAULT 'CENTER',
ADD COLUMN "detailPosterPosition" "MovieArtworkPosition" NOT NULL DEFAULT 'CENTER';
