ALTER TABLE "organizations"
ADD COLUMN "ticketFeeMinor" INTEGER NOT NULL DEFAULT 0;

UPDATE "organizations" AS organization
SET "ticketFeeMinor" = COALESCE((
  SELECT tier."feeMinor"
  FROM "price_tiers" AS tier
  WHERE tier."organizationId" = organization."id"
  ORDER BY tier."active" DESC, tier."createdAt" ASC
  LIMIT 1
), 0);

ALTER TABLE "organizations"
ADD CONSTRAINT "organizations_ticket_fee_minor_nonnegative"
CHECK ("ticketFeeMinor" >= 0);
