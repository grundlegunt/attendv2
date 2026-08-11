ALTER TYPE "PaymentPurpose" ADD VALUE 'GIFT_CARD_PURCHASE';
CREATE TYPE "GiftCardPurchaseStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'DELIVERED', 'DELIVERY_FAILED');
ALTER TABLE "gift_cards" ALTER COLUMN "issuedByEmployeeId" DROP NOT NULL;

CREATE TABLE "gift_card_purchases" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "locationId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL, "giftCardId" TEXT, "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD', "buyerEmail" TEXT NOT NULL,
  "recipientName" TEXT, "recipientEmail" TEXT NOT NULL, "message" TEXT,
  "status" "GiftCardPurchaseStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "idempotencyKey" TEXT NOT NULL, "deliveryMessageId" TEXT, "deliveryCodeEncrypted" TEXT, "deliveredAt" TIMESTAMP(3),
  "deliveryError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gift_card_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gift_card_purchases_amount_check" CHECK ("amountCents" >= 500 AND "amountCents" <= 100000)
);
CREATE UNIQUE INDEX "gift_card_purchases_paymentId_key" ON "gift_card_purchases"("paymentId");
CREATE UNIQUE INDEX "gift_card_purchases_giftCardId_key" ON "gift_card_purchases"("giftCardId");
CREATE UNIQUE INDEX "gift_card_purchases_idempotencyKey_key" ON "gift_card_purchases"("idempotencyKey");
CREATE INDEX "gift_card_purchases_organizationId_createdAt_idx" ON "gift_card_purchases"("organizationId", "createdAt");
CREATE INDEX "gift_card_purchases_recipientEmail_createdAt_idx" ON "gift_card_purchases"("recipientEmail", "createdAt");
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
