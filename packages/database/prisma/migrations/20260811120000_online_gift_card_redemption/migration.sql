ALTER TABLE "ticket_orders"
  ADD COLUMN "giftCardId" TEXT,
  ADD COLUMN "giftCardCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ticket_orders"
  ADD CONSTRAINT "ticket_orders_gift_card_amount_check"
  CHECK ("giftCardCents" >= 0 AND "giftCardCents" <= "totalCents");

CREATE INDEX "ticket_orders_giftCardId_createdAt_idx"
  ON "ticket_orders"("giftCardId", "createdAt");

ALTER TABLE "ticket_orders"
  ADD CONSTRAINT "ticket_orders_giftCardId_fkey"
  FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
