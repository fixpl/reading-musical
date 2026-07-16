-- CreateTable
CREATE TABLE "cue_tracks" (
    "id" TEXT NOT NULL,
    "production_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "owner_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cue_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_cues" (
    "id" TEXT NOT NULL,
    "production_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "scene_id" TEXT,
    "cue_number" TEXT NOT NULL,
    "trigger" TEXT,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_cues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cue_tracks_production_id_order_idx" ON "cue_tracks"("production_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "cue_tracks_production_id_name_key" ON "cue_tracks"("production_id", "name");

-- CreateIndex
CREATE INDEX "track_cues_production_id_track_id_order_idx" ON "track_cues"("production_id", "track_id", "order");

-- CreateIndex
CREATE INDEX "track_cues_scene_id_idx" ON "track_cues"("scene_id");

-- AddForeignKey
ALTER TABLE "cue_tracks" ADD CONSTRAINT "cue_tracks_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cue_tracks" ADD CONSTRAINT "cue_tracks_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "cue_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_cues" ADD CONSTRAINT "track_cues_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
