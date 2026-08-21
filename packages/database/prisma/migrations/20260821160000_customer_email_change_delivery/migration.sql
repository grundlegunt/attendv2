ALTER TABLE "customer_auth_accounts"
  ADD COLUMN "passwordResetTokenVersion" INTEGER,
  ADD COLUMN "emailChangeRequestId" TEXT,
  ADD COLUMN "emailChangeNewEmail" TEXT,
  ADD COLUMN "emailChangeTokenVersion" INTEGER,
  ADD COLUMN "emailChangeEmailClaimedAt" TIMESTAMP(3),
  ADD COLUMN "emailChangeEmailSentAt" TIMESTAMP(3),
  ADD COLUMN "emailChangeEmailMessageId" TEXT,
  ADD COLUMN "emailChangeEmailError" TEXT;

CREATE INDEX "customer_auth_email_change_claim_idx"
  ON "customer_auth_accounts"("emailChangeEmailSentAt", "emailChangeEmailClaimedAt", "updatedAt");
