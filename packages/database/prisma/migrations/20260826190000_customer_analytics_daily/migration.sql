CREATE TABLE "customer_analytics_daily" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "event" TEXT NOT NULL,
  "path" TEXT NOT NULL DEFAULT '',
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_analytics_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_analytics_daily_count_nonnegative" CHECK ("count" >= 0),
  CONSTRAINT "customer_analytics_daily_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_analytics_daily_locationId_date_event_path_key" ON "customer_analytics_daily"("locationId", "date", "event", "path");
CREATE INDEX "customer_analytics_daily_locationId_date_idx" ON "customer_analytics_daily"("locationId", "date");
