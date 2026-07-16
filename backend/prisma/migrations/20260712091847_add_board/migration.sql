-- CreateEnum
CREATE TYPE "board_category" AS ENUM ('NOTICE', 'QUESTION', 'MATERIAL');

-- CreateTable
CREATE TABLE "board_posts" (
    "id" TEXT NOT NULL,
    "production_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "category" "board_category" NOT NULL DEFAULT 'QUESTION',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_posts_production_id_pinned_created_at_idx" ON "board_posts"("production_id", "pinned", "created_at");

-- CreateIndex
CREATE INDEX "board_comments_post_id_created_at_idx" ON "board_comments"("post_id", "created_at");

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
