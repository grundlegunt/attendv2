ALTER TABLE "ticket_orders"
ADD COLUMN "smsDeliveryClaimedAt" TIMESTAMP(3),
ADD COLUMN "smsDeliverySentAt" TIMESTAMP(3),
ADD COLUMN "smsDeliveryMessageId" TEXT,
ADD COLUMN "smsDeliveryError" TEXT;

CREATE INDEX "ticket_orders_smsDeliverySentAt_smsDeliveryClaimedAt_updatedAt_idx"
ON "ticket_orders"("smsDeliverySentAt", "smsDeliveryClaimedAt", "updatedAt");

CREATE INDEX "ticket_orders_smsDeliverySentAt_smsDeliveryError_updatedAt_idx"
ON "ticket_orders"("smsDeliverySentAt", "smsDeliveryError", "updatedAt");
