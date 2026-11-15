-- Additive only: no production, member, policy, or inquiry is deleted/published here.
BEGIN;
ALTER TABLE "inquiries" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "source" JSONB, ADD COLUMN "production_snapshot" JSONB;
CREATE TABLE "inquiry_messages" (
 "id" TEXT PRIMARY KEY, "inquiry_id" TEXT NOT NULL, "author_kind" TEXT NOT NULL,
 "author_id" TEXT, "body" TEXT NOT NULL, "public" BOOLEAN NOT NULL DEFAULT false,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "inquiry_messages_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "inquiry_messages_inquiry_id_created_at_idx" ON "inquiry_messages"("inquiry_id", "created_at");
CREATE TABLE "inquiry_accesses" (
 "id" TEXT PRIMARY KEY, "inquiry_id" TEXT NOT NULL, "email" TEXT NOT NULL, "code_hash" TEXT NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0, "expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3),
 "session_hash" TEXT, "session_expires_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "inquiry_accesses_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inquiry_accesses_session_hash_key" ON "inquiry_accesses"("session_hash");
CREATE INDEX "inquiry_accesses_inquiry_id_created_at_idx" ON "inquiry_accesses"("inquiry_id", "created_at");
CREATE INDEX "inquiry_accesses_expires_at_idx" ON "inquiry_accesses"("expires_at");
CREATE TABLE "production_purges" (
 "id" TEXT PRIMARY KEY, "production_id" TEXT NOT NULL, "title" TEXT NOT NULL, "actor_id" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'FILES_PENDING', "assets" JSONB NOT NULL,
 "storage_identity" TEXT NOT NULL, "not_before" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
 "lease_token" TEXT, "lease_until" TIMESTAMP(3), "error_code" TEXT, "completed_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "production_purges_production_id_key" ON "production_purges"("production_id");
CREATE INDEX "production_purges_state_not_before_idx" ON "production_purges"("state", "not_before");
COMMIT;
