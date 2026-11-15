-- 관객용 소개와 공연별 출연진 동의만 추가한다. 기존 공연은 자동 게시하지 않는다.
CREATE TABLE "production_showcases" (
  "id" TEXT NOT NULL,
  "production_id" TEXT NOT NULL,
  "draft" JSONB NOT NULL,
  "published" JSONB,
  "published_at" TIMESTAMP(3),
  "published_by_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_showcases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_showcases_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "production_showcases_publication_check" CHECK (
    ("published_at" IS NULL AND ("published" IS NULL OR "published" = 'null'::jsonb)) OR
    ("published_at" IS NOT NULL AND "published" IS NOT NULL AND "published" <> 'null'::jsonb)
  )
);
CREATE UNIQUE INDEX "production_showcases_production_id_key" ON "production_showcases"("production_id");
CREATE INDEX "production_showcases_published_at_idx" ON "production_showcases"("published_at");
ALTER TABLE "production_showcases" ADD CONSTRAINT "production_showcases_production_id_fkey"
  FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "performance_credit_consents" (
  "id" TEXT NOT NULL,
  "membership_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "show_name" BOOLEAN NOT NULL DEFAULT false,
  "show_photo" BOOLEAN NOT NULL DEFAULT false,
  "photo_asset_id" TEXT,
  "photo_fingerprint" TEXT,
  "notice_version" TEXT NOT NULL,
  "consented_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_credit_consents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_credit_consents_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "performance_credit_consents_photo_check" CHECK (
    NOT "show_photo" OR ("show_name" AND "photo_asset_id" IS NOT NULL AND "photo_fingerprint" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "performance_credit_consents_membership_id_key" ON "performance_credit_consents"("membership_id");
ALTER TABLE "performance_credit_consents" ADD CONSTRAINT "performance_credit_consents_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
