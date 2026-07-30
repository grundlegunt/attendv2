CREATE TYPE "FulfillmentTicketStatus" AS ENUM (
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'DELIVERED',
  'CANCELED',
  'VOIDED',
  'REFIRE'
);

CREATE TABLE "fulfillment_tickets" (
  "id" TEXT NOT NULL,
  "restaurantOrderId" TEXT NOT NULL,
  "kitchenStationId" TEXT NOT NULL,
  "tabLabel" TEXT,
  "auditoriumName" TEXT,
  "seatLabels" TEXT[] NOT NULL,
  "showtimeId" TEXT,
  "showtimeStartsAt" TIMESTAMP(3),
  "serverName" TEXT NOT NULL,
  "status" "FulfillmentTicketStatus" NOT NULL DEFAULT 'NEW',
  "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "refireCount" INTEGER NOT NULL DEFAULT 0,
  "refiredFromId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fulfillment_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fulfillment_tickets_restaurantOrderId_fkey"
    FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_tickets_kitchenStationId_fkey"
    FOREIGN KEY ("kitchenStationId") REFERENCES "kitchen_stations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_tickets_refiredFromId_fkey"
    FOREIGN KEY ("refiredFromId") REFERENCES "fulfillment_tickets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fulfillment_tickets_refireCount_check"
    CHECK ("refireCount" >= 0)
);

CREATE INDEX "fulfillment_tickets_kitchenStationId_status_firedAt_idx"
  ON "fulfillment_tickets"("kitchenStationId", "status", "firedAt");
CREATE INDEX "fulfillment_tickets_restaurantOrderId_status_idx"
  ON "fulfillment_tickets"("restaurantOrderId", "status");
CREATE INDEX "fulfillment_tickets_refiredFromId_idx"
  ON "fulfillment_tickets"("refiredFromId");

CREATE TABLE "_FulfillmentTicketToRestaurantOrderItem" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_FulfillmentTicketToRestaurantOrderItem_A_fkey"
    FOREIGN KEY ("A") REFERENCES "fulfillment_tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_FulfillmentTicketToRestaurantOrderItem_B_fkey"
    FOREIGN KEY ("B") REFERENCES "restaurant_order_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_FulfillmentTicketToRestaurantOrderItem_AB_unique"
  ON "_FulfillmentTicketToRestaurantOrderItem"("A", "B");
CREATE INDEX "_FulfillmentTicketToRestaurantOrderItem_B_index"
  ON "_FulfillmentTicketToRestaurantOrderItem"("B");
