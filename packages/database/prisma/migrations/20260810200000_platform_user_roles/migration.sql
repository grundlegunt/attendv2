CREATE TYPE "PlatformUserRole" AS ENUM ('OWNER', 'OPERATOR', 'VIEWER');

ALTER TABLE "platform_users"
ADD COLUMN "role" "PlatformUserRole" NOT NULL DEFAULT 'OWNER';
