CREATE TYPE "TicketFeeThresholdPeriod" AS ENUM ('CONTRACT_YEAR', 'CALENDAR_YEAR', 'LIFETIME');

CREATE TABLE "ticket_fee_agreements" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "customerFeeMinor" INTEGER NOT NULL,
  "thresholdPeriod" "TicketFeeThresholdPeriod" NOT NULL DEFAULT 'CONTRACT_YEAR',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_fee_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_fee_agreement_tiers" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "startsAtTicket" INTEGER NOT NULL,
  "endsAtTicket" INTEGER,
  "platformShareMinor" INTEGER NOT NULL,
  "operatorShareMinor" INTEGER NOT NULL,
  CONSTRAINT "ticket_fee_agreement_tiers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_fee_agreements_organizationId_effectiveFrom_idx"
  ON "ticket_fee_agreements"("organizationId", "effectiveFrom");
CREATE UNIQUE INDEX "ticket_fee_agreement_tiers_agreementId_startsAtTicket_key"
  ON "ticket_fee_agreement_tiers"("agreementId", "startsAtTicket");

ALTER TABLE "ticket_fee_agreements" ADD CONSTRAINT "ticket_fee_agreements_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_fee_agreement_tiers" ADD CONSTRAINT "ticket_fee_agreement_tiers_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "ticket_fee_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_fee_agreements" ADD CONSTRAINT "ticket_fee_agreements_customerFeeMinor_check"
  CHECK ("customerFeeMinor" >= 0);
ALTER TABLE "ticket_fee_agreement_tiers" ADD CONSTRAINT "ticket_fee_agreement_tiers_values_check"
  CHECK ("startsAtTicket" >= 1 AND ("endsAtTicket" IS NULL OR "endsAtTicket" >= "startsAtTicket") AND "platformShareMinor" >= 0 AND "operatorShareMinor" >= 0);
