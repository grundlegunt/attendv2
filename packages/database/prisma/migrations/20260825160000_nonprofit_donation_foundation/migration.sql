CREATE TYPE "DonationPaymentMethod" AS ENUM ('CASH', 'CHECK', 'EXTERNAL', 'ONLINE');
CREATE TYPE "DonationStatus" AS ENUM ('SETTLED', 'REFUNDED');

CREATE TABLE "donation_campaigns" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "goalAmountCents" INTEGER,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "donation_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "donations" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "campaignId" TEXT,
  "customerId" TEXT,
  "donorName" TEXT,
  "donorEmail" TEXT,
  "amountCents" INTEGER NOT NULL,
  "taxDeductibleAmountCents" INTEGER NOT NULL,
  "paymentMethod" "DonationPaymentMethod" NOT NULL,
  "status" "DonationStatus" NOT NULL DEFAULT 'SETTLED',
  "externalReference" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "donation_campaigns_organizationId_name_key" ON "donation_campaigns"("organizationId", "name");
CREATE INDEX "donation_campaigns_organizationId_active_startsAt_idx" ON "donation_campaigns"("organizationId", "active", "startsAt");
CREATE INDEX "donations_locationId_receivedAt_idx" ON "donations"("locationId", "receivedAt");
CREATE INDEX "donations_campaignId_receivedAt_idx" ON "donations"("campaignId", "receivedAt");
CREATE INDEX "donations_customerId_receivedAt_idx" ON "donations"("customerId", "receivedAt");

ALTER TABLE "donation_campaigns" ADD CONSTRAINT "donation_campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "donations" ADD CONSTRAINT "donations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "donation_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "donations" ADD CONSTRAINT "donations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
