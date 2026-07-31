CREATE TYPE "CashDrawerStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CashTransactionType" AS ENUM ('SALE', 'REFUND', 'PAID_IN', 'PAID_OUT');
CREATE TYPE "PromotionType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE', 'COMP');
CREATE TYPE "ShiftClockMethod" AS ENUM ('PIN', 'BADGE', 'MANAGER_OVERRIDE');

ALTER TABLE "locations" ADD COLUMN "timeClockEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "staff_auth_accounts" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "ticket_orders" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "promotionId" TEXT;

CREATE TABLE "cash_drawers" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "registerId" TEXT NOT NULL,
  "status" "CashDrawerStatus" NOT NULL DEFAULT 'OPEN',
  "openingBalanceCents" INTEGER NOT NULL,
  "closingBalanceCents" INTEGER,
  "expectedBalanceCents" INTEGER,
  "openedByEmployeeId" TEXT NOT NULL,
  "closedByEmployeeId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_drawers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_drawers_balances_check" CHECK ("openingBalanceCents" >= 0 AND ("closingBalanceCents" IS NULL OR "closingBalanceCents" >= 0))
);

CREATE TABLE "promotions" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PromotionType" NOT NULL,
  "amountCents" INTEGER,
  "percentageBasisPoints" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotions_value_check" CHECK (
    ("type" = 'FIXED_AMOUNT' AND "amountCents" IS NOT NULL AND "amountCents" > 0 AND "percentageBasisPoints" IS NULL) OR
    ("type" = 'PERCENTAGE' AND "percentageBasisPoints" BETWEEN 1 AND 10000 AND "amountCents" IS NULL) OR
    ("type" = 'COMP' AND "amountCents" IS NULL AND "percentageBasisPoints" IS NULL)
  ),
  CONSTRAINT "promotions_dates_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE TABLE "cash_transactions" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "cashDrawerId" TEXT NOT NULL,
  "ticketOrderId" TEXT,
  "employeeId" TEXT NOT NULL,
  "type" "CashTransactionType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "cashReceivedCents" INTEGER,
  "changeGivenCents" INTEGER,
  "reason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_transactions_amount_check" CHECK ("amountCents" > 0 AND ("cashReceivedCents" IS NULL OR "cashReceivedCents" >= 0) AND ("changeGivenCents" IS NULL OR "changeGivenCents" >= 0))
);

CREATE TABLE "shifts" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "scheduledStartAt" TIMESTAMP(3),
  "scheduledEndAt" TIMESTAMP(3),
  "clockInAt" TIMESTAMP(3) NOT NULL,
  "clockOutAt" TIMESTAMP(3),
  "clockInMethod" "ShiftClockMethod" NOT NULL DEFAULT 'PIN',
  "breakStartAt" TIMESTAMP(3),
  "breakEndAt" TIMESTAMP(3),
  "adjustedByEmployeeId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shifts_times_check" CHECK (
    ("clockOutAt" IS NULL OR "clockOutAt" >= "clockInAt") AND
    ("breakStartAt" IS NULL OR "breakStartAt" >= "clockInAt") AND
    ("breakEndAt" IS NULL OR ("breakStartAt" IS NOT NULL AND "breakEndAt" >= "breakStartAt"))
  )
);

CREATE UNIQUE INDEX "cash_transactions_idempotencyKey_key" ON "cash_transactions"("idempotencyKey");
CREATE INDEX "cash_drawers_locationId_registerId_status_idx" ON "cash_drawers"("locationId", "registerId", "status");
CREATE INDEX "cash_transactions_cashDrawerId_createdAt_idx" ON "cash_transactions"("cashDrawerId", "createdAt");
CREATE INDEX "cash_transactions_ticketOrderId_idx" ON "cash_transactions"("ticketOrderId");
CREATE UNIQUE INDEX "promotions_locationId_code_key" ON "promotions"("locationId", "code");
CREATE INDEX "promotions_locationId_active_idx" ON "promotions"("locationId", "active");
CREATE INDEX "shifts_employeeId_clockInAt_idx" ON "shifts"("employeeId", "clockInAt");
CREATE INDEX "shifts_locationId_clockInAt_idx" ON "shifts"("locationId", "clockInAt");

ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_openedByEmployeeId_fkey" FOREIGN KEY ("openedByEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_closedByEmployeeId_fkey" FOREIGN KEY ("closedByEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "cash_drawers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_ticketOrderId_fkey" FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_adjustedByEmployeeId_fkey" FOREIGN KEY ("adjustedByEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
