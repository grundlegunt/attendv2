CREATE TYPE "ShowtimeWaitlistStatus" AS ENUM ('ACTIVE', 'NOTIFIED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "showtime_waitlist_entries" (
  "id" TEXT NOT NULL,
  "showtimeId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" "ShowtimeWaitlistStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "notifiedAt" TIMESTAMP(3),
  "notificationClaimedAt" TIMESTAMP(3),
  "notificationMessageId" TEXT,
  "notificationError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "showtime_waitlist_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "showtime_waitlist_entries_requestId_key" ON "showtime_waitlist_entries"("requestId");
CREATE UNIQUE INDEX "showtime_waitlist_entries_showtimeId_email_key" ON "showtime_waitlist_entries"("showtimeId", "email");
CREATE INDEX "showtime_waitlist_entries_status_expiresAt_createdAt_idx" ON "showtime_waitlist_entries"("status", "expiresAt", "createdAt");
CREATE INDEX "showtime_waitlist_entries_status_notificationClaimedAt_createdAt_idx" ON "showtime_waitlist_entries"("status", "notificationClaimedAt", "createdAt");
ALTER TABLE "showtime_waitlist_entries" ADD CONSTRAINT "showtime_waitlist_entries_showtimeId_fkey" FOREIGN KEY ("showtimeId") REFERENCES "showtimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
