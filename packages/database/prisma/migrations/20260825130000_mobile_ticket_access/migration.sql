ALTER TABLE "ticket_orders"
ADD COLUMN "mobileAccessTokenHash" TEXT,
ADD COLUMN "mobileAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN "mobileAccessRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ticket_orders_mobileAccessTokenHash_key"
ON "ticket_orders"("mobileAccessTokenHash");

CREATE INDEX "ticket_orders_mobileAccessExpiresAt_mobileAccessRevokedAt_idx"
ON "ticket_orders"("mobileAccessExpiresAt", "mobileAccessRevokedAt");
