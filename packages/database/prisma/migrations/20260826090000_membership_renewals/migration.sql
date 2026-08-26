DROP INDEX "membership_checkouts_membershipId_key";

CREATE INDEX "membership_checkouts_membershipId_createdAt_idx"
  ON "membership_checkouts"("membershipId", "createdAt");
