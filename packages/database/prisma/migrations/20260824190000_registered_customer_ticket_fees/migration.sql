ALTER TABLE "organizations"
ADD COLUMN "registeredTicketFeeMinor" INTEGER;

UPDATE "organizations"
SET "registeredTicketFeeMinor" = "ticketFeeMinor";

ALTER TABLE "organizations"
ALTER COLUMN "registeredTicketFeeMinor" SET NOT NULL,
ALTER COLUMN "registeredTicketFeeMinor" SET DEFAULT 0;

ALTER TABLE "price_tiers"
ADD COLUMN "registeredFeeMinor" INTEGER;

UPDATE "price_tiers"
SET "registeredFeeMinor" = "feeMinor";

ALTER TABLE "price_tiers"
ALTER COLUMN "registeredFeeMinor" SET NOT NULL,
ALTER COLUMN "registeredFeeMinor" SET DEFAULT 0;
