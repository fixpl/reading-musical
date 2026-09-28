-- Additive migration: existing scripts, scenes, cues and schedule references are untouched.
ALTER TABLE "productions" ADD COLUMN "composition_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "assets" ADD COLUMN "file_name" TEXT;

CREATE TABLE "performance_sections" (
  "id" TEXT NOT NULL,
  "production_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'CHAPTER',
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "script_text" TEXT NOT NULL DEFAULT '',
  "lyrics" TEXT NOT NULL DEFAULT '',
  "start_ms" INTEGER,
  "duration_ms" INTEGER,
  "background_mode" TEXT NOT NULL DEFAULT 'INHERIT',
  "music_mode" TEXT NOT NULL DEFAULT 'INHERIT',
  "score_mode" TEXT NOT NULL DEFAULT 'INHERIT',
  "source_script_id" TEXT,
  "source_scene_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "archive_batch_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_sections_kind_check" CHECK ("kind" IN ('CHAPTER', 'ACT', 'SCENE', 'SECTION')),
  CONSTRAINT "performance_sections_start_check" CHECK ("start_ms" IS NULL OR "start_ms" BETWEEN 0 AND 86400000),
  CONSTRAINT "performance_sections_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" BETWEEN 1000 AND 86400000),
  CONSTRAINT "performance_sections_modes_check" CHECK (
    "background_mode" IN ('INHERIT', 'OWN', 'NONE') AND
    "music_mode" IN ('INHERIT', 'OWN', 'NONE') AND
    "score_mode" IN ('INHERIT', 'OWN', 'NONE')),
  CONSTRAINT "performance_sections_parent_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);
CREATE INDEX "performance_sections_production_id_parent_id_order_idx" ON "performance_sections"("production_id", "parent_id", "order");
CREATE INDEX "performance_sections_source_script_id_idx" ON "performance_sections"("source_script_id");
CREATE INDEX "performance_sections_source_scene_id_idx" ON "performance_sections"("source_scene_id");
ALTER TABLE "performance_sections" ADD CONSTRAINT "performance_sections_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_sections" ADD CONSTRAINT "performance_sections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "performance_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_sections" ADD CONSTRAINT "performance_sections_source_script_id_fkey" FOREIGN KEY ("source_script_id") REFERENCES "scripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_sections" ADD CONSTRAINT "performance_sections_source_scene_id_fkey" FOREIGN KEY ("source_scene_id") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "performance_media" (
  "id" TEXT NOT NULL,
  "section_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "slot" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "offset_ms" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER,
  "source_start_ms" INTEGER NOT NULL DEFAULT 0,
  "page" INTEGER NOT NULL DEFAULT 1,
  "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "loop" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_media_slot_check" CHECK ("slot" IN ('SCORE', 'BACKGROUND', 'MUSIC', 'SOURCE')),
  CONSTRAINT "performance_media_time_check" CHECK ("offset_ms" BETWEEN 0 AND 86400000 AND "source_start_ms" BETWEEN 0 AND 86400000 AND ("duration_ms" IS NULL OR "duration_ms" BETWEEN 1000 AND 86400000)),
  CONSTRAINT "performance_media_page_check" CHECK ("page" BETWEEN 1 AND 10000),
  CONSTRAINT "performance_media_volume_check" CHECK ("volume" BETWEEN 0 AND 1)
);
CREATE INDEX "performance_media_section_id_slot_order_idx" ON "performance_media"("section_id", "slot", "order");
CREATE INDEX "performance_media_asset_id_idx" ON "performance_media"("asset_id");
ALTER TABLE "performance_media" ADD CONSTRAINT "performance_media_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "performance_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_media" ADD CONSTRAINT "performance_media_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
