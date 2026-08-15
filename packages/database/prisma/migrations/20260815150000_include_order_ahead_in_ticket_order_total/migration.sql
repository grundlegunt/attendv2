ALTER TABLE "ticket_orders"
DROP CONSTRAINT "ticket_orders_money_check";

ALTER TABLE "ticket_orders"
ADD CONSTRAINT "ticket_orders_money_check"
CHECK (
  "subtotalCents" >= 0 AND
  "discountCents" >= 0 AND
  "discountCents" <= "subtotalCents" AND
  "feesCents" >= 0 AND
  "taxCents" >= 0 AND
  "orderAheadSubtotalCents" >= 0 AND
  "orderAheadTaxCents" >= 0 AND
  "orderAheadServiceChargeCents" >= 0 AND
  "totalCents" >= 0 AND
  "totalCents" =
    "subtotalCents" - "discountCents" + "feesCents" + "taxCents" +
    "orderAheadSubtotalCents" + "orderAheadTaxCents" +
    "orderAheadServiceChargeCents"
);
