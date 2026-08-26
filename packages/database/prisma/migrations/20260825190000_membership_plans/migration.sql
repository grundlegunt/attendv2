CREATE TABLE "membership_plans" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER NOT NULL,
  "durationMonths" INTEGER NOT NULL,
  "benefits" JSONB NOT NULL,
  "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "memberships" ADD COLUMN "planId" TEXT;
CREATE UNIQUE INDEX "membership_plans_organizationId_name_key" ON "membership_plans"("organizationId", "name");
CREATE INDEX "membership_plans_organizationId_active_idx" ON "membership_plans"("organizationId", "active");
CREATE INDEX "memberships_planId_status_idx" ON "memberships"("planId", "status");
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
