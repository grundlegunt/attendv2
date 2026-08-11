ALTER TABLE "modifier_groups"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "modifier_groups_menuItemId_sortOrder_idx";

CREATE INDEX "modifier_groups_menuItemId_active_sortOrder_idx"
ON "modifier_groups"("menuItemId", "active", "sortOrder");
