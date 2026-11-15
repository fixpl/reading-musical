CREATE TABLE "personal_rehearsals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "production_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "position_ms" INTEGER NOT NULL DEFAULT 0,
    "completed_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "personal_rehearsals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "personal_rehearsals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personal_rehearsals_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personal_rehearsals_user_id_production_id_source_key" ON "personal_rehearsals"("user_id", "production_id", "source");
CREATE INDEX "personal_rehearsals_production_id_idx" ON "personal_rehearsals"("production_id");
