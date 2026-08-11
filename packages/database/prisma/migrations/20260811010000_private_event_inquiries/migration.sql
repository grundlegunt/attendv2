CREATE TABLE "private_event_inquiries" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "eventType" TEXT NOT NULL,
  "preferredDate" TIMESTAMP(3),
  "guestCount" INTEGER,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "private_event_inquiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "private_event_inquiries_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "private_event_inquiries_locationId_status_createdAt_idx" ON "private_event_inquiries"("locationId", "status", "createdAt");
