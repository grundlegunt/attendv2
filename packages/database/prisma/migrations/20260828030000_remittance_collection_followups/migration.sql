ALTER TABLE "ticket_fee_remittances"
ADD COLUMN "lastContactedAt" TIMESTAMP(3),
ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);

CREATE INDEX "ticket_fee_remittances_status_nextFollowUpAt_idx"
ON "ticket_fee_remittances"("status", "nextFollowUpAt");
