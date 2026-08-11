ALTER TABLE "gift_card_purchases" ADD COLUMN "deliveryClaimedAt" TIMESTAMP(3);
CREATE INDEX "gift_card_purchases_deliveryClaimedAt_idx" ON "gift_card_purchases"("deliveryClaimedAt");
