CREATE TYPE "SeatType" AS ENUM ('STANDARD', 'ADA', 'COMPANION');
CREATE TYPE "TablePosition" AS ENUM ('LEFT', 'RIGHT');

CREATE TABLE "auditoriums" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auditoriums_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seat_maps" (
  "id" TEXT NOT NULL,
  "auditoriumId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seat_maps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seats" (
  "id" TEXT NOT NULL,
  "seatMapId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "rowLabel" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "type" "SeatType" NOT NULL DEFAULT 'STANDARD',
  "tableGroupId" TEXT,
  "tablePosition" "TablePosition",
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "synopsis" TEXT,
  "runtimeMinutes" INTEGER NOT NULL,
  "rating" TEXT,
  "posterUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_tiers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ticketPriceMinor" INTEGER NOT NULL,
  "feeMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "appliesOnWeekdays" INTEGER[] NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "showtimes" (
  "id" TEXT NOT NULL,
  "movieId" TEXT NOT NULL,
  "auditoriumId" TEXT NOT NULL,
  "priceTierId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "featureStartsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "roomReadyAt" TIMESTAMP(3) NOT NULL,
  "onSale" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "showtimes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auditoriums_locationId_name_key" ON "auditoriums"("locationId", "name");
CREATE INDEX "auditoriums_locationId_active_idx" ON "auditoriums"("locationId", "active");
CREATE UNIQUE INDEX "seat_maps_auditoriumId_key" ON "seat_maps"("auditoriumId");
CREATE UNIQUE INDEX "seats_seatMapId_label_key" ON "seats"("seatMapId", "label");
CREATE UNIQUE INDEX "seats_seatMapId_x_y_key" ON "seats"("seatMapId", "x", "y");
CREATE INDEX "seats_seatMapId_rowLabel_number_idx" ON "seats"("seatMapId", "rowLabel", "number");
CREATE INDEX "movies_organizationId_active_idx" ON "movies"("organizationId", "active");
CREATE UNIQUE INDEX "price_tiers_organizationId_name_key" ON "price_tiers"("organizationId", "name");
CREATE INDEX "price_tiers_organizationId_active_idx" ON "price_tiers"("organizationId", "active");
CREATE INDEX "showtimes_auditoriumId_startsAt_idx" ON "showtimes"("auditoriumId", "startsAt");
CREATE INDEX "showtimes_movieId_startsAt_idx" ON "showtimes"("movieId", "startsAt");

ALTER TABLE "auditoriums" ADD CONSTRAINT "auditoriums_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seat_maps" ADD CONSTRAINT "seat_maps_auditoriumId_fkey"
  FOREIGN KEY ("auditoriumId") REFERENCES "auditoriums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seats" ADD CONSTRAINT "seats_seatMapId_fkey"
  FOREIGN KEY ("seatMapId") REFERENCES "seat_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movies" ADD CONSTRAINT "movies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_movieId_fkey"
  FOREIGN KEY ("movieId") REFERENCES "movies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_auditoriumId_fkey"
  FOREIGN KEY ("auditoriumId") REFERENCES "auditoriums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_priceTierId_fkey"
  FOREIGN KEY ("priceTierId") REFERENCES "price_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
