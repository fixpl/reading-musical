-- 큐 인물 태그 + 예상 길이(초)
ALTER TABLE "track_cues" ADD COLUMN "character_id" TEXT;
ALTER TABLE "track_cues" ADD COLUMN "duration_sec" INTEGER;

ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "track_cues_character_id_idx" ON "track_cues"("character_id");
