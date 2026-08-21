ALTER TABLE "restaurant_tabs"
  ADD COLUMN "paymentFailureEmailClaimedAt" TIMESTAMP(3),
  ADD COLUMN "paymentFailureEmailSentAt" TIMESTAMP(3),
  ADD COLUMN "paymentFailureEmailMessageId" TEXT,
  ADD COLUMN "paymentFailureEmailError" TEXT;

CREATE INDEX "restaurant_tabs_payment_failure_email_claim_idx"
  ON "restaurant_tabs"("status", "paymentFailureEmailSentAt", "paymentFailureEmailClaimedAt", "updatedAt");
CREATE INDEX "restaurant_tabs_payment_failure_email_retry_idx"
  ON "restaurant_tabs"("status", "paymentFailureEmailSentAt", "paymentFailureEmailError", "updatedAt");
