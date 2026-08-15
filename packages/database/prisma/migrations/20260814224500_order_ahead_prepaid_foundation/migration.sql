CREATE TYPE "RestaurantOrderSource" AS ENUM ('STAFF', 'ONLINE_ORDER_AHEAD');

ALTER TABLE "restaurant_tabs"
  ADD COLUMN "prepaidCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "restaurant_orders"
  ALTER COLUMN "serverEmployeeId" DROP NOT NULL,
  ADD COLUMN "source" "RestaurantOrderSource" NOT NULL DEFAULT 'STAFF',
  ADD COLUMN "ticketOrderId" TEXT;

ALTER TABLE "restaurant_orders"
  ADD CONSTRAINT "restaurant_orders_ticketOrderId_fkey"
  FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "restaurant_tabs"
  ADD CONSTRAINT "restaurant_tabs_prepaid_nonnegative_check"
  CHECK ("prepaidCents" >= 0);

CREATE INDEX "restaurant_orders_ticketOrderId_createdAt_idx"
  ON "restaurant_orders"("ticketOrderId", "createdAt");
