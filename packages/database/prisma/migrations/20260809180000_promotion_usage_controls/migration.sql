ALTER TABLE "promotions"
  ADD COLUMN "minimumSubtotalCents" INTEGER,
  ADD COLUMN "maximumRedemptions" INTEGER,
  ADD CONSTRAINT "promotions_usage_controls_check" CHECK (
    ("minimumSubtotalCents" IS NULL OR "minimumSubtotalCents" >= 0) AND
    ("maximumRedemptions" IS NULL OR "maximumRedemptions" > 0)
  );
