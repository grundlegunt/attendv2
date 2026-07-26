CREATE TABLE "showtime_seats" (
  "id" TEXT NOT NULL,
  "showtimeId" TEXT NOT NULL,
  "seatId" TEXT NOT NULL,
  "blockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "showtime_seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seat_holds" (
  "id" TEXT NOT NULL,
  "showtimeSeatId" TEXT NOT NULL,
  "holdToken" TEXT NOT NULL,
  "holderKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seat_holds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "showtime_seats_showtimeId_seatId_key"
  ON "showtime_seats"("showtimeId", "seatId");
CREATE INDEX "showtime_seats_showtimeId_blockedAt_idx"
  ON "showtime_seats"("showtimeId", "blockedAt");
CREATE UNIQUE INDEX "seat_holds_holdToken_key" ON "seat_holds"("holdToken");
CREATE INDEX "seat_holds_showtimeSeatId_expiresAt_releasedAt_idx"
  ON "seat_holds"("showtimeSeatId", "expiresAt", "releasedAt");
CREATE INDEX "seat_holds_holderKey_expiresAt_idx"
  ON "seat_holds"("holderKey", "expiresAt");

ALTER TABLE "showtime_seats"
  ADD CONSTRAINT "showtime_seats_showtimeId_fkey"
  FOREIGN KEY ("showtimeId") REFERENCES "showtimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "showtime_seats"
  ADD CONSTRAINT "showtime_seats_seatId_fkey"
  FOREIGN KEY ("seatId") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seat_holds"
  ADD CONSTRAINT "seat_holds_showtimeSeatId_fkey"
  FOREIGN KEY ("showtimeSeatId") REFERENCES "showtime_seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "showtime_seats" ("id", "showtimeId", "seatId", "updatedAt")
SELECT gen_random_uuid()::text, st."id", s."id", CURRENT_TIMESTAMP
FROM "showtimes" st
JOIN "auditoriums" a ON a."id" = st."auditoriumId"
JOIN "seat_maps" sm ON sm."auditoriumId" = a."id"
JOIN "seats" s ON s."seatMapId" = sm."id" AND s."active" = TRUE
ON CONFLICT ("showtimeId", "seatId") DO NOTHING;
