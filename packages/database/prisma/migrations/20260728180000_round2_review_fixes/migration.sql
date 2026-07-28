-- Round 2 review fixes: durable "needs human review" state for a payment
-- verification mismatch (TicketingService.finalizeOrder's amount/currency/
-- metadata check), and a claim lease for the refund-reconciliation job
-- (TicketingService.reconcilePendingRefunds). Previously neither had any
-- database trace at all -- see schema.prisma's comments on Payment and
-- Refund for the full reasoning.

ALTER TABLE "payments" ADD COLUMN "verificationFailedAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "verificationFailureNote" TEXT;

CREATE INDEX "payments_verificationFailedAt_idx" ON "payments"("verificationFailedAt");

ALTER TABLE "refunds" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "refunds_status_leaseExpiresAt_idx" ON "refunds"("status", "leaseExpiresAt");
CREATE INDEX "refunds_providerRefundId_idx" ON "refunds"("providerRefundId");
