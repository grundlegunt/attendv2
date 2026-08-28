CREATE TYPE "TicketFeeRemittanceStatus" AS ENUM ('DUE', 'PAID', 'VOID');

CREATE TABLE "ticket_fee_remittances" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "periodFrom" TIMESTAMP(3) NOT NULL,
  "periodTo" TIMESTAMP(3) NOT NULL,
  "statementAsOf" TIMESTAMP(3) NOT NULL,
  "ticketCount" INTEGER NOT NULL,
  "collectedFeeCents" INTEGER NOT NULL,
  "platformShareCents" INTEGER NOT NULL,
  "operatorShareCents" INTEGER NOT NULL,
  "varianceCents" INTEGER NOT NULL,
  "status" "TicketFeeRemittanceStatus" NOT NULL DEFAULT 'DUE',
  "dueDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "paymentReference" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_fee_remittances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_fee_remittances_agreementId_periodFrom_key"
  ON "ticket_fee_remittances"("agreementId", "periodFrom");
CREATE INDEX "ticket_fee_remittances_organizationId_status_dueDate_idx"
  ON "ticket_fee_remittances"("organizationId", "status", "dueDate");

ALTER TABLE "ticket_fee_remittances"
  ADD CONSTRAINT "ticket_fee_remittances_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_fee_remittances"
  ADD CONSTRAINT "ticket_fee_remittances_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "ticket_fee_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
