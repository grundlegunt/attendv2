ALTER TYPE "CustomerConsentType" ADD VALUE 'SMS_TICKET_DELIVERY';

ALTER TABLE "ticket_orders"
ADD COLUMN "guestPhone" TEXT,
ADD COLUMN "smsTicketsRequested" BOOLEAN NOT NULL DEFAULT false;
