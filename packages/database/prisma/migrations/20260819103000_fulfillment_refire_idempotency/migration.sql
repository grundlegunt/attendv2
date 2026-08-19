ALTER TABLE "fulfillment_tickets"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "fulfillment_tickets_refiredFromId_idempotencyKey_key"
ON "fulfillment_tickets"("refiredFromId", "idempotencyKey");
