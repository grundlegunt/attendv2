DROP INDEX IF EXISTS "restaurant_receipts_emailSentAt_emailClaimedAt_idx";

CREATE INDEX "gift_card_purchases_deliveredAt_deliveryClaimedAt_updatedAt_idx"
  ON "gift_card_purchases"("deliveredAt", "deliveryClaimedAt", "updatedAt");
CREATE INDEX "gift_card_purchases_status_deliveredAt_updatedAt_idx"
  ON "gift_card_purchases"("status", "deliveredAt", "updatedAt");
CREATE INDEX "ticket_orders_receiptEmailSentAt_receiptEmailClaimedAt_updatedAt_idx"
  ON "ticket_orders"("receiptEmailSentAt", "receiptEmailClaimedAt", "updatedAt");
CREATE INDEX "ticket_orders_receiptEmailSentAt_receiptEmailError_updatedAt_idx"
  ON "ticket_orders"("receiptEmailSentAt", "receiptEmailError", "updatedAt");
CREATE INDEX "restaurant_receipts_emailSentAt_emailClaimedAt_updatedAt_idx"
  ON "restaurant_receipts"("emailSentAt", "emailClaimedAt", "updatedAt");
CREATE INDEX "restaurant_receipts_emailSentAt_emailError_updatedAt_idx"
  ON "restaurant_receipts"("emailSentAt", "emailError", "updatedAt");
