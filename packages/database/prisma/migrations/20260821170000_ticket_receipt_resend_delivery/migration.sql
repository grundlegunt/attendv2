ALTER TABLE "ticket_orders"
  ADD COLUMN "receiptResendRequestId" TEXT,
  ADD COLUMN "receiptResendActorType" "AuditActorType",
  ADD COLUMN "receiptResendActorId" TEXT,
  ADD COLUMN "receiptResendPreviousEmail" TEXT;
