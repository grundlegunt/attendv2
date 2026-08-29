ALTER TABLE "membership_checkouts"
ADD COLUMN "receiptClaimedAt" TIMESTAMP(3);

ALTER TABLE "donation_checkouts"
ADD COLUMN "receiptClaimedAt" TIMESTAMP(3);
