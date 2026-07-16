-- 공연 소프트 삭제: 실데이터 보존, 삭제됨 표시 + 복구용 필드
ALTER TABLE "productions" ADD COLUMN "deleted_at" TIMESTAMP(3);
