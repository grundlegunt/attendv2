ALTER TABLE "platform_brand_settings"
ADD COLUMN "analytics" JSONB NOT NULL DEFAULT '{"enabled":false,"provider":"PLAUSIBLE"}'::jsonb;
