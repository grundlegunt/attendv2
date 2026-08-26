ALTER TABLE "membership_plans"
ADD COLUMN "benefitsFairMarketValueCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "membership_checkouts"
ADD COLUMN "taxDeductibleAmountCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "membership_plans"
ADD CONSTRAINT "membership_plans_benefits_fmv_valid"
CHECK ("benefitsFairMarketValueCents" >= 0 AND "benefitsFairMarketValueCents" <= "priceCents");

ALTER TABLE "membership_checkouts"
ADD CONSTRAINT "membership_checkouts_deductible_valid"
CHECK ("taxDeductibleAmountCents" >= 0 AND "taxDeductibleAmountCents" <= "amountCents");
