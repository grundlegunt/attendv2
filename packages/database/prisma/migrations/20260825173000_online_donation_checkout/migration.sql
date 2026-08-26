ALTER TYPE "PaymentPurpose" ADD VALUE 'DONATION';

CREATE TYPE "DonationCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

CREATE TABLE "donation_checkouts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "campaignId" TEXT,
  "paymentId" TEXT NOT NULL,
  "donationId" TEXT,
  "donorName" TEXT,
  "donorEmail" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "DonationCheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "receiptMessageId" TEXT,
  "receiptSentAt" TIMESTAMP(3),
  "receiptError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "donation_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "donation_checkouts_paymentId_key" ON "donation_checkouts"("paymentId");
CREATE UNIQUE INDEX "donation_checkouts_donationId_key" ON "donation_checkouts"("donationId");
CREATE UNIQUE INDEX "donation_checkouts_idempotencyKey_key" ON "donation_checkouts"("idempotencyKey");
CREATE INDEX "donation_checkouts_organizationId_createdAt_idx" ON "donation_checkouts"("organizationId", "createdAt");
CREATE INDEX "donation_checkouts_locationId_createdAt_idx" ON "donation_checkouts"("locationId", "createdAt");
CREATE INDEX "donation_checkouts_campaignId_createdAt_idx" ON "donation_checkouts"("campaignId", "createdAt");
CREATE INDEX "donation_checkouts_status_updatedAt_idx" ON "donation_checkouts"("status", "updatedAt");

ALTER TABLE "donation_checkouts" ADD CONSTRAINT "donation_checkouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "donation_checkouts" ADD CONSTRAINT "donation_checkouts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "donation_checkouts" ADD CONSTRAINT "donation_checkouts_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "donation_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "donation_checkouts" ADD CONSTRAINT "donation_checkouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "donation_checkouts" ADD CONSTRAINT "donation_checkouts_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "donations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
