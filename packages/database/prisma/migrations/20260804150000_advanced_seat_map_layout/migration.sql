ALTER TABLE "seat_maps"
ADD COLUMN "layoutJson" JSONB;

ALTER TABLE "seats"
ADD COLUMN "layoutVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "levelKey" TEXT,
ADD COLUMN "sectionKey" TEXT;

DROP INDEX "seats_seatMapId_label_key";
DROP INDEX "seats_seatMapId_x_y_key";
DROP INDEX "seats_seatMapId_rowLabel_number_idx";

CREATE UNIQUE INDEX "seats_seatMapId_layoutVersion_label_key"
ON "seats"("seatMapId", "layoutVersion", "label");
CREATE UNIQUE INDEX "seats_seatMapId_layoutVersion_levelKey_x_y_key"
ON "seats"("seatMapId", "layoutVersion", "levelKey", "x", "y");
CREATE INDEX "seats_seatMapId_layoutVersion_rowLabel_number_idx"
ON "seats"("seatMapId", "layoutVersion", "rowLabel", "number");

CREATE TABLE "seat_map_revisions" (
  "id" TEXT NOT NULL,
  "seatMapId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "layoutJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seat_map_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "seat_map_revisions_seatMapId_fkey"
    FOREIGN KEY ("seatMapId") REFERENCES "seat_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "seat_map_revisions_seatMapId_version_key"
ON "seat_map_revisions"("seatMapId", "version");
CREATE INDEX "seat_map_revisions_seatMapId_createdAt_idx"
ON "seat_map_revisions"("seatMapId", "createdAt");

INSERT INTO "seat_map_revisions" ("id", "seatMapId", "version", "layoutJson")
SELECT gen_random_uuid()::text, "id", "version", "layoutJson" FROM "seat_maps";
