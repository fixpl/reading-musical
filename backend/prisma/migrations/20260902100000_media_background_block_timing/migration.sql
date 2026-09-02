-- 배경 영상·미디어 첨부·대본 블록 타임라인 배치
ALTER TYPE "asset_kind" ADD VALUE 'VIDEO';

ALTER TABLE "scene_blocks" ADD COLUMN "start_ms" INTEGER;
ALTER TABLE "scene_blocks" ADD COLUMN "duration_ms" INTEGER;

ALTER TABLE "track_cues" ADD COLUMN "asset_id" TEXT;
ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "track_cues_asset_id_idx" ON "track_cues"("asset_id");

ALTER TABLE "productions" ADD COLUMN "background_asset_id" TEXT;
ALTER TABLE "productions" ADD CONSTRAINT "productions_background_asset_id_fkey"
  FOREIGN KEY ("background_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
