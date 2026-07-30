CREATE TYPE "CustomerConsentType" AS ENUM (
  'DINING_AUTO_SETTLEMENT',
  'TERMS_OF_SERVICE',
  'MARKETING'
);

CREATE TYPE "RestaurantTabType" AS ENUM ('SEAT_LINKED', 'WALK_IN');

CREATE TYPE "RestaurantTabStatus" AS ENUM (
  'PREAUTHORIZED',
  'OPEN',
  'READY_TO_CLOSE',
  'SETTLEMENT_PENDING',
  'PAYMENT_FAILED',
  'MANAGER_REVIEW',
  'CLOSED',
  'REFUNDED',
  'VOIDED'
);

CREATE TABLE "customer_consents" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" "CustomerConsentType" NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL,
  "ticketOrderId" TEXT,
  "paymentMethodReferenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_consents_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_consents_ticketOrderId_fkey"
    FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_consents_paymentMethodReferenceId_fkey"
    FOREIGN KEY ("paymentMethodReferenceId") REFERENCES "payment_method_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_consents_ticketOrderId_type_key"
  ON "customer_consents"("ticketOrderId", "type");
CREATE INDEX "customer_consents_customerId_type_grantedAt_idx"
  ON "customer_consents"("customerId", "type", "grantedAt");
CREATE INDEX "customer_consents_ticketOrderId_idx"
  ON "customer_consents"("ticketOrderId");

CREATE TABLE "restaurant_tabs" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "primaryCustomerId" TEXT,
  "tabType" "RestaurantTabType" NOT NULL,
  "showtimeId" TEXT,
  "label" TEXT,
  "status" "RestaurantTabStatus" NOT NULL,
  "autoSettleAuthorized" BOOLEAN NOT NULL DEFAULT false,
  "activePaymentMethodId" TEXT,
  "activePaymentMethodSetAt" TIMESTAMP(3),
  "autoSettleAt" TIMESTAMP(3),
  "checkDroppedAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_tabs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_tabs_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_tabs_primaryCustomerId_fkey"
    FOREIGN KEY ("primaryCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_tabs_showtimeId_fkey"
    FOREIGN KEY ("showtimeId") REFERENCES "showtimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_tabs_activePaymentMethodId_fkey"
    FOREIGN KEY ("activePaymentMethodId") REFERENCES "payment_method_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_tabs_shape_check" CHECK (
    ("tabType" = 'SEAT_LINKED' AND "showtimeId" IS NOT NULL AND "label" IS NULL) OR
    ("tabType" = 'WALK_IN' AND "showtimeId" IS NULL AND "label" IS NOT NULL)
  ),
  CONSTRAINT "restaurant_tabs_auto_settle_check" CHECK (
    "tabType" = 'SEAT_LINKED' OR "autoSettleAuthorized" = false
  )
);

CREATE INDEX "restaurant_tabs_locationId_status_openedAt_idx"
  ON "restaurant_tabs"("locationId", "status", "openedAt");
CREATE INDEX "restaurant_tabs_showtimeId_status_idx"
  ON "restaurant_tabs"("showtimeId", "status");

CREATE TABLE "restaurant_tab_seats" (
  "id" TEXT NOT NULL,
  "restaurantTabId" TEXT NOT NULL,
  "showtimeSeatId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_tab_seats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_tab_seats_restaurantTabId_fkey"
    FOREIGN KEY ("restaurantTabId") REFERENCES "restaurant_tabs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_tab_seats_showtimeSeatId_fkey"
    FOREIGN KEY ("showtimeSeatId") REFERENCES "showtime_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_tab_seats_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "restaurant_tab_seats_showtimeSeatId_restaurantTabId_key"
  ON "restaurant_tab_seats"("showtimeSeatId", "restaurantTabId");
CREATE UNIQUE INDEX "restaurant_tab_seats_ticketId_restaurantTabId_key"
  ON "restaurant_tab_seats"("ticketId", "restaurantTabId");
CREATE INDEX "restaurant_tab_seats_restaurantTabId_idx"
  ON "restaurant_tab_seats"("restaurantTabId");

ALTER TABLE "showtime_seats" ADD COLUMN "currentTabSeatId" TEXT;
CREATE UNIQUE INDEX "showtime_seats_currentTabSeatId_key"
  ON "showtime_seats"("currentTabSeatId");
ALTER TABLE "showtime_seats"
  ADD CONSTRAINT "showtime_seats_currentTabSeatId_fkey"
  FOREIGN KEY ("currentTabSeatId") REFERENCES "restaurant_tab_seats"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "restaurantTabId" TEXT;
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_restaurantTabId_fkey"
  FOREIGN KEY ("restaurantTabId") REFERENCES "restaurant_tabs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_restaurantTabId_status_idx"
  ON "payments"("restaurantTabId", "status");
