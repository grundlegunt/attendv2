ALTER TABLE "restaurant_order_items"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "restaurant_order_items_restaurantOrderId_idempotencyKey_key"
ON "restaurant_order_items"("restaurantOrderId", "idempotencyKey");
