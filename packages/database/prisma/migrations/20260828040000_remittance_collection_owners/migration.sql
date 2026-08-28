ALTER TABLE "ticket_fee_remittances"
ADD COLUMN "collectionOwnerId" TEXT;

ALTER TABLE "ticket_fee_remittances"
ADD CONSTRAINT "ticket_fee_remittances_collectionOwnerId_fkey"
FOREIGN KEY ("collectionOwnerId") REFERENCES "platform_users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ticket_fee_remittances_collectionOwnerId_status_idx"
ON "ticket_fee_remittances"("collectionOwnerId", "status");
