CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');
CREATE TYPE "GiftCardTransactionType" AS ENUM ('ISSUANCE', 'REDEMPTION', 'REFUND', 'ADJUSTMENT');

CREATE TABLE "gift_cards" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "issuedAtLocationId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeLast4" TEXT NOT NULL,
  "initialBalanceCents" INTEGER NOT NULL,
  "balanceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "recipientName" TEXT,
  "recipientEmail" TEXT,
  "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
  "issuedByEmployeeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gift_cards_balance_check" CHECK ("initialBalanceCents" > 0 AND "balanceCents" >= 0)
);

CREATE TABLE "gift_card_transactions" (
  "id" TEXT NOT NULL,
  "giftCardId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "type" "GiftCardTransactionType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "balanceAfterCents" INTEGER NOT NULL,
  "employeeId" TEXT,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gift_card_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gift_card_transactions_balance_check" CHECK ("balanceAfterCents" >= 0 AND "amountCents" <> 0)
);

CREATE UNIQUE INDEX "gift_cards_codeHash_key" ON "gift_cards"("codeHash");
CREATE INDEX "gift_cards_organizationId_createdAt_idx" ON "gift_cards"("organizationId", "createdAt");
CREATE INDEX "gift_cards_organizationId_codeLast4_idx" ON "gift_cards"("organizationId", "codeLast4");
CREATE INDEX "gift_card_transactions_giftCardId_createdAt_idx" ON "gift_card_transactions"("giftCardId", "createdAt");
CREATE INDEX "gift_card_transactions_locationId_createdAt_idx" ON "gift_card_transactions"("locationId", "createdAt");

ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_issuedAtLocationId_fkey" FOREIGN KEY ("issuedAtLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_issuedByEmployeeId_fkey" FOREIGN KEY ("issuedByEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
