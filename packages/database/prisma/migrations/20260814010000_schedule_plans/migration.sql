CREATE TABLE "schedule_plans" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "weekStartsAt" TIMESTAMP(3) NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "schedule_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_plans_locationId_weekStartsAt_name_key"
ON "schedule_plans"("locationId", "weekStartsAt", "name");

CREATE INDEX "schedule_plans_locationId_weekStartsAt_idx"
ON "schedule_plans"("locationId", "weekStartsAt");

ALTER TABLE "schedule_plans"
ADD CONSTRAINT "schedule_plans_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
