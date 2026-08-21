ALTER TABLE "restaurant_receipts"
  ADD COLUMN "emailClaimedAt" TIMESTAMP(3),
  ADD COLUMN "emailSentAt" TIMESTAMP(3),
  ADD COLUMN "emailMessageId" TEXT,
  ADD COLUMN "emailError" TEXT;

CREATE INDEX "restaurant_receipts_emailSentAt_emailClaimedAt_idx"
  ON "restaurant_receipts"("emailSentAt", "emailClaimedAt");
