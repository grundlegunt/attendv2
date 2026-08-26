ALTER TYPE "PaymentPurpose" ADD VALUE 'MEMBERSHIP';

CREATE TYPE "MembershipCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

CREATE TABLE "membership_checkouts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "membershipId" TEXT,
  "memberName" TEXT NOT NULL,
  "memberEmail" TEXT NOT NULL,
  "planName" TEXT NOT NULL,
  "planDescription" TEXT,
  "planBenefits" JSONB NOT NULL,
  "durationMonths" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "MembershipCheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "receiptMessageId" TEXT,
  "receiptSentAt" TIMESTAMP(3),
  "receiptError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "membership_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_checkouts_paymentId_key" ON "membership_checkouts"("paymentId");
CREATE UNIQUE INDEX "membership_checkouts_membershipId_key" ON "membership_checkouts"("membershipId");
CREATE UNIQUE INDEX "membership_checkouts_idempotencyKey_key" ON "membership_checkouts"("idempotencyKey");
CREATE INDEX "membership_checkouts_organizationId_createdAt_idx" ON "membership_checkouts"("organizationId", "createdAt");
CREATE INDEX "membership_checkouts_locationId_createdAt_idx" ON "membership_checkouts"("locationId", "createdAt");
CREATE INDEX "membership_checkouts_planId_createdAt_idx" ON "membership_checkouts"("planId", "createdAt");
CREATE INDEX "membership_checkouts_status_updatedAt_idx" ON "membership_checkouts"("status", "updatedAt");
ALTER TABLE "membership_checkouts" ADD CONSTRAINT "membership_checkouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_checkouts" ADD CONSTRAINT "membership_checkouts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_checkouts" ADD CONSTRAINT "membership_checkouts_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_checkouts" ADD CONSTRAINT "membership_checkouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_checkouts" ADD CONSTRAINT "membership_checkouts_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
