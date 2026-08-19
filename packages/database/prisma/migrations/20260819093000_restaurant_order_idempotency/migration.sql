ALTER TABLE "restaurant_orders"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "restaurant_orders_restaurantTabId_idempotencyKey_key"
ON "restaurant_orders"("restaurantTabId", "idempotencyKey");
