ALTER TABLE "ticket_fee_remittances"
ADD COLUMN "reconciliationNote" TEXT;

UPDATE "ticket_fee_remittances"
SET "reconciliationNote" = "notes"
WHERE "varianceCents" <> 0
  AND "notes" IS NOT NULL;
