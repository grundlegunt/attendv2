-- Membership lookup is case-insensitive in Admin and POS. Enforce the same
-- identity rule in storage so differently-cased duplicates cannot be created.
UPDATE "memberships"
SET "membershipNumber" = UPPER(TRIM("membershipNumber"));

CREATE UNIQUE INDEX "memberships_organizationId_membershipNumber_ci_key"
ON "memberships" ("organizationId", LOWER("membershipNumber"));
