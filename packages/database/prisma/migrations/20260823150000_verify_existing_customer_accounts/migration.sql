-- Customer email verification was not enforced before this migration. Existing
-- password accounts have already been usable in production, so preserve their
-- access when verification becomes an authentication requirement.
UPDATE "customer_auth_accounts"
SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt")
WHERE "passwordHash" IS NOT NULL
  AND "emailVerifiedAt" IS NULL;
