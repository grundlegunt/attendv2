ALTER TABLE "restaurant_tabs"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "restaurant_tabs_locationId_idempotencyKey_key"
ON "restaurant_tabs"("locationId", "idempotencyKey");
