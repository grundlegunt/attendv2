-- Milestone 3: ticket checkout, ticket records, and payment state.
-- Money values are stored in integer cents. Card data is never stored here.

CREATE TYPE "ConnectOnboardingStatus" AS ENUM (
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETE',
  'RESTRICTED'
);

CREATE TYPE "TicketOrderChannel" AS ENUM ('ONLINE', 'BOX_OFFICE');
CREATE TYPE "TicketOrderStatus" AS ENUM (
  'CART',
  'AWAITING_PAYMENT',
  'PAYMENT_FAILED',
  'PAID',
  'EXPIRED',
  'ABANDONED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'EXCHANGED'
);
CREATE TYPE "TicketStatus" AS ENUM ('ISSUED', 'ADMITTED', 'REFUNDED', 'TRANSFERRED', 'CANCELED');
CREATE TYPE "PaymentPurpose" AS ENUM ('TICKET_ORDER', 'RESTAURANT_TAB');
CREATE TYPE "PaymentStatus" AS ENUM (
  'CREATED',
  'REQUIRES_PAYMENT_METHOD',
  'REQUIRES_ACTION',
  'PROCESSING',
  'AUTHORIZED',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'PARTIALLY_REFUNDED',
  'REFUNDED'
);
CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'CREATED',
  'REQUIRES_ACTION',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED'
);
CREATE TYPE "RefundStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "RefundScope" AS ENUM ('TICKET', 'RESTAURANT', 'BOTH');

ALTER TABLE "organizations"
  ADD COLUMN "stripeConnectedAccountId" TEXT,
  ADD COLUMN "connectOnboardingStatus" "ConnectOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE "locations"
  ADD COLUMN "ticketTaxRateBasisPoints" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_ticketTaxRateBasisPoints_check"
  CHECK ("ticketTaxRateBasisPoints" >= 0 AND "ticketTaxRateBasisPoints" <= 10000);

CREATE TABLE "ticket_types" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_types_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ticket_types_locationId_name_key" ON "ticket_types"("locationId", "name");
CREATE INDEX "ticket_types_locationId_active_idx" ON "ticket_types"("locationId", "active");

CREATE TABLE "ticket_orders" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "customerId" TEXT,
  "ticketTypeId" TEXT NOT NULL,
  "holdTokens" TEXT[] NOT NULL,
  "holderKey" TEXT NOT NULL,
  "guestEmail" TEXT,
  "guestName" TEXT,
  "diningAuthorizationRequested" BOOLEAN,
  "channel" "TicketOrderChannel" NOT NULL DEFAULT 'ONLINE',
  "status" "TicketOrderStatus" NOT NULL DEFAULT 'CART',
  "orderNumber" TEXT NOT NULL,
  "checkoutIdempotencyKey" TEXT NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "feesCents" INTEGER NOT NULL,
  "taxCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "placedByEmployeeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_orders_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ticket_orders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ticket_orders_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ticket_orders_placedByEmployeeId_fkey"
    FOREIGN KEY ("placedByEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ticket_orders_money_check"
    CHECK (
      "subtotalCents" >= 0 AND
      "feesCents" >= 0 AND
      "taxCents" >= 0 AND
      "totalCents" >= 0 AND
      "totalCents" = "subtotalCents" + "feesCents" + "taxCents"
    )
);

CREATE UNIQUE INDEX "ticket_orders_orderNumber_key" ON "ticket_orders"("orderNumber");
CREATE UNIQUE INDEX "ticket_orders_checkoutIdempotencyKey_key"
  ON "ticket_orders"("checkoutIdempotencyKey");
CREATE INDEX "ticket_orders_locationId_createdAt_idx" ON "ticket_orders"("locationId", "createdAt");
CREATE INDEX "ticket_orders_customerId_createdAt_idx" ON "ticket_orders"("customerId", "createdAt");

CREATE TABLE "tickets" (
  "id" TEXT NOT NULL,
  "ticketOrderId" TEXT NOT NULL,
  "showtimeSeatId" TEXT NOT NULL,
  "ticketTypeId" TEXT NOT NULL,
  "priceCentsPaid" INTEGER NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'ISSUED',
  "qrToken" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tickets_ticketOrderId_fkey"
    FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tickets_showtimeSeatId_fkey"
    FOREIGN KEY ("showtimeSeatId") REFERENCES "showtime_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tickets_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tickets_priceCentsPaid_check" CHECK ("priceCentsPaid" >= 0)
);

CREATE UNIQUE INDEX "tickets_qrToken_key" ON "tickets"("qrToken");
CREATE INDEX "tickets_ticketOrderId_idx" ON "tickets"("ticketOrderId");
CREATE INDEX "tickets_showtimeSeatId_status_idx" ON "tickets"("showtimeSeatId", "status");
CREATE UNIQUE INDEX "ux_ticket_active_seat"
  ON "tickets"("showtimeSeatId")
  WHERE "status" NOT IN ('REFUNDED', 'CANCELED');

CREATE TABLE "payment_customers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerCustomerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_customers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_customers_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_customers_organizationId_customerId_provider_key"
  ON "payment_customers"("organizationId", "customerId", "provider");
CREATE UNIQUE INDEX "payment_customers_organizationId_provider_providerCustomerId_key"
  ON "payment_customers"("organizationId", "provider", "providerCustomerId");

CREATE TABLE "payment_method_references" (
  "id" TEXT NOT NULL,
  "paymentCustomerId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentMethodId" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "expMonth" INTEGER NOT NULL,
  "expYear" INTEGER NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_method_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_method_references_paymentCustomerId_fkey"
    FOREIGN KEY ("paymentCustomerId") REFERENCES "payment_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_method_references_last4_check" CHECK ("last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "payment_method_references_expMonth_check" CHECK ("expMonth" BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX "payment_method_references_paymentCustomerId_provider_providerPaymentMethodId_key"
  ON "payment_method_references"("paymentCustomerId", "provider", "providerPaymentMethodId");
CREATE INDEX "payment_method_references_paymentCustomerId_active_idx"
  ON "payment_method_references"("paymentCustomerId", "active");

CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "purpose" "PaymentPurpose" NOT NULL,
  "ticketOrderId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "tipCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "paymentMethodReferenceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_ticketOrderId_fkey"
    FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_paymentMethodReferenceId_fkey"
    FOREIGN KEY ("paymentMethodReferenceId") REFERENCES "payment_method_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_amount_check" CHECK ("amountCents" >= 0 AND ("tipCents" IS NULL OR "tipCents" >= 0))
);

CREATE UNIQUE INDEX "payments_ticketOrderId_key" ON "payments"("ticketOrderId");
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

CREATE TABLE "payment_attempts" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerIntentId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_attempts_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payment_attempts_attemptNumber_check" CHECK ("attemptNumber" > 0)
);

CREATE UNIQUE INDEX "payment_attempts_paymentId_attemptNumber_key"
  ON "payment_attempts"("paymentId", "attemptNumber");
CREATE UNIQUE INDEX "payment_attempts_provider_providerIntentId_key"
  ON "payment_attempts"("provider", "providerIntentId");

CREATE TABLE "refunds" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "scope" "RefundScope" NOT NULL DEFAULT 'TICKET',
  "status" "RefundStatus" NOT NULL DEFAULT 'CREATED',
  "idempotencyKey" TEXT NOT NULL,
  "providerRefundId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refunds_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refunds_amountCents_check" CHECK ("amountCents" >= 0)
);

CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");
CREATE INDEX "refunds_paymentId_status_idx" ON "refunds"("paymentId", "status");

CREATE TABLE "processed_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processed_webhook_events_provider_providerEventId_key"
  ON "processed_webhook_events"("provider", "providerEventId");
