-- Additive migration. Existing cues remain untimed; do not invent start times.
ALTER TABLE "track_cues" ADD COLUMN "start_ms" INTEGER;
ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_start_ms_range"
  CHECK ("start_ms" IS NULL OR ("start_ms" >= 0 AND "start_ms" <= 86400000));
