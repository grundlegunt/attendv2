ALTER TABLE "ticket_orders"
  ADD COLUMN "orderAheadItems" JSONB,
  ADD COLUMN "orderAheadSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "orderAheadTaxCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "orderAheadServiceChargeCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ticket_orders"
  ADD CONSTRAINT "ticket_orders_order_ahead_amounts_nonnegative"
  CHECK (
    "orderAheadSubtotalCents" >= 0
    AND "orderAheadTaxCents" >= 0
    AND "orderAheadServiceChargeCents" >= 0
  );
