CREATE TYPE "RestaurantChargeCategory" AS ENUM ('FOOD', 'ALCOHOL', 'NA_BEVERAGE');
CREATE TYPE "RestaurantChargeAppliesTo" AS ENUM ('ALL', 'FOOD', 'ALCOHOL', 'NA_BEVERAGE');

ALTER TABLE "locations"
  ADD COLUMN "checkDropMinutesBeforeEnd" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "autoSettleGraceMinutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "autoSettleTipBasisPoints" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "menu_items"
  ADD COLUMN "chargeCategory" "RestaurantChargeCategory" NOT NULL DEFAULT 'FOOD';

ALTER TABLE "restaurant_tabs"
  ADD COLUMN "checkDroppedByEmployeeId" TEXT,
  ADD COLUMN "selectedTipCents" INTEGER,
  ADD COLUMN "subtotalCents" INTEGER,
  ADD COLUMN "taxCents" INTEGER,
  ADD COLUMN "serviceChargeCents" INTEGER,
  ADD COLUMN "totalCents" INTEGER;

CREATE TABLE "tax_rules" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "appliesTo" "RestaurantChargeAppliesTo" NOT NULL,
  "ratePermille" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_rules_rate_check" CHECK ("ratePermille" >= 0)
);

CREATE TABLE "service_charge_rules" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "appliesTo" "RestaurantChargeAppliesTo" NOT NULL,
  "ratePermille" INTEGER,
  "flatCents" INTEGER,
  "autoApply" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_charge_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_charge_rules_amount_check" CHECK (
    ("ratePermille" IS NOT NULL AND "flatCents" IS NULL AND "ratePermille" >= 0)
    OR ("ratePermille" IS NULL AND "flatCents" IS NOT NULL AND "flatCents" >= 0)
  )
);

CREATE TABLE "restaurant_receipts" (
  "id" TEXT NOT NULL,
  "restaurantTabId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "taxCents" INTEGER NOT NULL,
  "serviceChargeCents" INTEGER NOT NULL,
  "tipCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "tenderSummary" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_receipts_amount_check" CHECK (
    "subtotalCents" >= 0 AND "taxCents" >= 0 AND "serviceChargeCents" >= 0
    AND "tipCents" >= 0 AND "totalCents" >= 0
  )
);

CREATE UNIQUE INDEX "tax_rules_locationId_name_key" ON "tax_rules"("locationId", "name");
CREATE INDEX "tax_rules_locationId_active_idx" ON "tax_rules"("locationId", "active");
CREATE UNIQUE INDEX "service_charge_rules_locationId_name_key" ON "service_charge_rules"("locationId", "name");
CREATE INDEX "service_charge_rules_locationId_active_autoApply_idx" ON "service_charge_rules"("locationId", "active", "autoApply");
CREATE UNIQUE INDEX "restaurant_receipts_restaurantTabId_key" ON "restaurant_receipts"("restaurantTabId");
CREATE UNIQUE INDEX "restaurant_receipts_receiptNumber_key" ON "restaurant_receipts"("receiptNumber");
CREATE INDEX "restaurant_tabs_checkDroppedAt_idx" ON "restaurant_tabs"("locationId", "checkDroppedAt", "status");

ALTER TABLE "tax_rules"
  ADD CONSTRAINT "tax_rules_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_charge_rules"
  ADD CONSTRAINT "service_charge_rules_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "restaurant_tabs"
  ADD CONSTRAINT "restaurant_tabs_checkDroppedByEmployeeId_fkey"
  FOREIGN KEY ("checkDroppedByEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "restaurant_receipts"
  ADD CONSTRAINT "restaurant_receipts_restaurantTabId_fkey"
  FOREIGN KEY ("restaurantTabId") REFERENCES "restaurant_tabs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_settlement_config_check" CHECK (
    "checkDropMinutesBeforeEnd" >= 0
    AND "autoSettleGraceMinutes" >= 0
    AND "autoSettleTipBasisPoints" BETWEEN 0 AND 10000
  );
ALTER TABLE "restaurant_tabs"
  ADD CONSTRAINT "restaurant_tabs_settlement_amount_check" CHECK (
    ("selectedTipCents" IS NULL OR "selectedTipCents" >= 0)
    AND ("subtotalCents" IS NULL OR "subtotalCents" >= 0)
    AND ("taxCents" IS NULL OR "taxCents" >= 0)
    AND ("serviceChargeCents" IS NULL OR "serviceChargeCents" >= 0)
    AND ("totalCents" IS NULL OR "totalCents" >= 0)
  );
