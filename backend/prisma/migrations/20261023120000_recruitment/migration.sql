-- 모집·지원은 기존 공연·회원 정보를 변경하지 않고 별도 저장한다.
BEGIN;
CREATE TYPE "recruitment_round_status" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE "recruitment_position_role" AS ENUM ('ACTOR', 'STAFF');
CREATE TYPE "recruitment_application_status" AS ENUM ('SUBMITTED', 'REVIEWING', 'ON_HOLD', 'APPROVED', 'NOT_SELECTED', 'WITHDRAWN', 'CANCELLED');
CREATE TABLE "recruitment_rounds" (
  "id" TEXT NOT NULL, "production_id" TEXT NOT NULL,
  "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "description" TEXT NOT NULL,
  "region" TEXT NOT NULL, "activity_start_date" DATE, "activity_end_date" DATE,
  "conditions" TEXT NOT NULL, "deadline_at" TIMESTAMP(3),
  "status" "recruitment_round_status" NOT NULL DEFAULT 'DRAFT', "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT NOT NULL, "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recruitment_rounds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruitment_rounds_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "recruitment_rounds_activity_range_check" CHECK ("activity_start_date" IS NULL OR "activity_end_date" IS NULL OR "activity_end_date" >= "activity_start_date"),
  CONSTRAINT "recruitment_rounds_publication_check" CHECK ("status" NOT IN ('OPEN', 'CLOSED') OR "published_at" IS NOT NULL)
);
CREATE INDEX "recruitment_rounds_production_id_created_at_idx" ON "recruitment_rounds"("production_id", "created_at");
CREATE INDEX "recruitment_rounds_status_published_at_idx" ON "recruitment_rounds"("status", "published_at");
ALTER TABLE "recruitment_rounds" ADD CONSTRAINT "recruitment_rounds_production_id_fkey"
  FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "recruitment_positions" (
  "id" TEXT NOT NULL, "round_id" TEXT NOT NULL, "role" "recruitment_position_role" NOT NULL,
  "label" TEXT NOT NULL, "capacity" INTEGER NOT NULL, "order" INTEGER NOT NULL,
  CONSTRAINT "recruitment_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruitment_positions_capacity_check" CHECK ("capacity" BETWEEN 1 AND 1000),
  CONSTRAINT "recruitment_positions_order_check" CHECK ("order" >= 0)
);
CREATE UNIQUE INDEX "recruitment_positions_id_round_id_key" ON "recruitment_positions"("id", "round_id");
CREATE INDEX "recruitment_positions_round_id_order_idx" ON "recruitment_positions"("round_id", "order");
ALTER TABLE "recruitment_positions" ADD CONSTRAINT "recruitment_positions_round_id_fkey"
  FOREIGN KEY ("round_id") REFERENCES "recruitment_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "recruitment_applications" (
  "id" TEXT NOT NULL, "round_id" TEXT NOT NULL, "position_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "status" "recruitment_application_status" NOT NULL DEFAULT 'SUBMITTED', "revision" INTEGER NOT NULL DEFAULT 1,
  "message" TEXT NOT NULL, "availability" TEXT NOT NULL, "review_message" TEXT,
  "reviewed_by_id" TEXT, "reviewed_at" TIMESTAMP(3), "membership_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recruitment_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruitment_applications_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "recruitment_applications_round_id_user_id_key" ON "recruitment_applications"("round_id", "user_id");
CREATE INDEX "recruitment_applications_user_id_updated_at_idx" ON "recruitment_applications"("user_id", "updated_at");
CREATE INDEX "recruitment_applications_position_id_status_idx" ON "recruitment_applications"("position_id", "status");
ALTER TABLE "recruitment_applications" ADD CONSTRAINT "recruitment_applications_round_id_fkey"
  FOREIGN KEY ("round_id") REFERENCES "recruitment_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recruitment_applications" ADD CONSTRAINT "recruitment_applications_position_id_round_id_fkey"
  FOREIGN KEY ("position_id", "round_id") REFERENCES "recruitment_positions"("id", "round_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recruitment_applications" ADD CONSTRAINT "recruitment_applications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recruitment_applications" ADD CONSTRAINT "recruitment_applications_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "recruitment_application_events" (
  "id" TEXT NOT NULL, "application_id" TEXT NOT NULL,
  "from_status" "recruitment_application_status", "to_status" "recruitment_application_status" NOT NULL,
  "actor_id" TEXT NOT NULL, "message" TEXT, "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recruitment_application_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruitment_application_events_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "recruitment_application_events_application_id_revision_key" ON "recruitment_application_events"("application_id", "revision");
ALTER TABLE "recruitment_application_events" ADD CONSTRAINT "recruitment_application_events_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "recruitment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
