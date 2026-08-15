CREATE TYPE "AuditoriumSeatingMode" AS ENUM ('RESERVED', 'GENERAL_ADMISSION');

ALTER TABLE "auditoriums"
ADD COLUMN "seatingMode" "AuditoriumSeatingMode" NOT NULL DEFAULT 'RESERVED';
