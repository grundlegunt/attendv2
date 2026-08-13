ALTER TABLE "gift_cards"
  ADD COLUMN "issuanceRequestId" TEXT,
  ADD COLUMN "issuanceCodeEncrypted" TEXT;

CREATE UNIQUE INDEX "gift_cards_issuanceRequestId_key"
  ON "gift_cards"("issuanceRequestId");
