CREATE TYPE "BrandingAdminTheme" AS ENUM ('NEUTRAL', 'MATCH_CUSTOMER');

CREATE TABLE "location_branding" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "eyebrow" TEXT NOT NULL DEFAULT 'ATTEND',
  "displayName" TEXT NOT NULL DEFAULT 'Cinema',
  "logoUrl" TEXT,
  "accentColor" TEXT NOT NULL DEFAULT '#d4af37',
  "accentMutedColor" TEXT NOT NULL DEFAULT '#8a7326',
  "backgroundColor" TEXT NOT NULL DEFAULT '#0b0b0d',
  "elevatedColor" TEXT NOT NULL DEFAULT '#16161a',
  "textPrimaryColor" TEXT NOT NULL DEFAULT '#f5f3ee',
  "textSecondaryColor" TEXT NOT NULL DEFAULT '#a8a49c',
  "adminTheme" "BrandingAdminTheme" NOT NULL DEFAULT 'NEUTRAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "location_branding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_branding_locationId_key" UNIQUE ("locationId"),
  CONSTRAINT "location_branding_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "location_branding_colors_check" CHECK (
    "accentColor" ~ '^#[0-9A-Fa-f]{6}$' AND
    "accentMutedColor" ~ '^#[0-9A-Fa-f]{6}$' AND
    "backgroundColor" ~ '^#[0-9A-Fa-f]{6}$' AND
    "elevatedColor" ~ '^#[0-9A-Fa-f]{6}$' AND
    "textPrimaryColor" ~ '^#[0-9A-Fa-f]{6}$' AND
    "textSecondaryColor" ~ '^#[0-9A-Fa-f]{6}$'
  )
);

INSERT INTO "location_branding" (
  "id", "locationId", "eyebrow", "displayName", "accentColor", "accentMutedColor", "updatedAt"
)
SELECT gen_random_uuid()::text, "id", 'MERIDIAN', 'Cinema', '#fe2c54', '#a91d39', CURRENT_TIMESTAMP
FROM "locations"
WHERE lower("name") = 'meridian cinema'
ON CONFLICT ("locationId") DO NOTHING;

INSERT INTO "permissions" ("id", "key", "description", "createdAt")
VALUES (gen_random_uuid()::text, 'branding.manage', 'Manage customer and admin branding for a location', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'branding.manage'
WHERE r."key" IN ('OWNER', 'GENERAL_MANAGER')
ON CONFLICT DO NOTHING;
