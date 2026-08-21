ALTER TABLE "customer_auth_accounts"
  ADD COLUMN "passwordResetRequestId" TEXT,
  ADD COLUMN "passwordResetEmailClaimedAt" TIMESTAMP(3),
  ADD COLUMN "passwordResetEmailSentAt" TIMESTAMP(3),
  ADD COLUMN "passwordResetEmailMessageId" TEXT,
  ADD COLUMN "passwordResetEmailError" TEXT;

CREATE INDEX "customer_auth_password_reset_claim_idx"
  ON "customer_auth_accounts"("passwordResetEmailSentAt", "passwordResetEmailClaimedAt", "updatedAt");
