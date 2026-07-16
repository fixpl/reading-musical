-- 대본·큐 소프트 삭제 필드 (실데이터 보존, 감추기+복구)
ALTER TABLE "scripts" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "track_cues" ADD COLUMN "deleted_at" TIMESTAMP(3);
