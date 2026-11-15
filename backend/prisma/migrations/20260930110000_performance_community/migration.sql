ALTER TABLE "board_posts"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'TEAM',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "source" TEXT,
  ADD COLUMN "unit_key" TEXT,
  ADD COLUMN "position_ms" INTEGER,
  ADD COLUMN "context_label" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "board_posts" SET "channel" = 'NOTICE' WHERE "category" = 'NOTICE';
UPDATE "board_posts" SET "channel" = 'MATERIAL' WHERE "category" = 'MATERIAL';
CREATE INDEX "board_posts_production_id_visibility_channel_created_at_idx" ON "board_posts"("production_id", "visibility", "channel", "created_at");
CREATE INDEX "board_posts_production_id_source_position_ms_idx" ON "board_posts"("production_id", "source", "position_ms");
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_community_scope_check"
  CHECK ("visibility" IN ('TEAM', 'PRIVATE') AND "channel" IN ('GENERAL', 'REHEARSAL', 'TECH', 'NOTICE', 'MATERIAL') AND "status" IN ('OPEN', 'RESOLVED'));
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_context_check"
  CHECK (("source" IS NULL AND "unit_key" IS NULL AND "position_ms" IS NULL AND "context_label" IS NULL)
    OR ("source" IS NOT NULL AND "unit_key" IS NOT NULL AND "position_ms" IS NOT NULL AND "position_ms" BETWEEN 0 AND 86400000 AND "context_label" IS NOT NULL));
