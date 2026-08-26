CREATE TABLE "platform_brand_settings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "companyName" TEXT NOT NULL DEFAULT 'Ringo',
    "masterTheme" JSONB NOT NULL,
    "masterSignIn" JSONB NOT NULL,
    "adminSignIn" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_brand_settings_pkey" PRIMARY KEY ("id")
);
