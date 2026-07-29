CREATE TYPE "TicketScanResult" AS ENUM (
  'VALID',
  'ALREADY_USED',
  'WRONG_SHOWTIME',
  'REFUNDED',
  'CANCELED',
  'INVALID'
);

CREATE TABLE "ticket_scans" (
  "id" UUID NOT NULL,
  "ticketId" UUID,
  "scannedByEmployeeId" UUID NOT NULL,
  "expectedShowtimeId" UUID,
  "deviceId" TEXT,
  "entrance" TEXT,
  "result" "TicketScanResult" NOT NULL,
  "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_scans_ticketId_scannedAt_idx"
  ON "ticket_scans"("ticketId", "scannedAt");
CREATE INDEX "ticket_scans_scannedByEmployeeId_scannedAt_idx"
  ON "ticket_scans"("scannedByEmployeeId", "scannedAt");

ALTER TABLE "ticket_scans"
  ADD CONSTRAINT "ticket_scans_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_scans"
  ADD CONSTRAINT "ticket_scans_scannedByEmployeeId_fkey"
  FOREIGN KEY ("scannedByEmployeeId") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
