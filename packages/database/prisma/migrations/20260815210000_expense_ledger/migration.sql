CREATE TYPE "ExpenseCategory" AS ENUM ('FILM_RENTAL', 'FOOD_BEVERAGE', 'PAYROLL', 'OCCUPANCY', 'MARKETING', 'EQUIPMENT', 'MAINTENANCE', 'UTILITIES', 'INSURANCE', 'OTHER');

CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "vendor" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expenses_locationId_incurredAt_idx" ON "expenses"("locationId", "incurredAt");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
