ALTER TABLE "locations"
  ADD COLUMN "contentDraft" JSONB,
  ADD COLUMN "contentPublished" JSONB,
  ADD COLUMN "contentPublishedAt" TIMESTAMP(3);
