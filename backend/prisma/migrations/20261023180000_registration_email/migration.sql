-- 계정 생성 전 이메일 인증을 별도 보관한다. 기존 회원 상태와 인증 수단은 변경하지 않는다.
BEGIN;
CREATE TABLE "registration_email_challenges" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verified_at" TIMESTAMP(3),
  "proof_hash" TEXT,
  "proof_expires_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_email_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_email_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5)
);
CREATE UNIQUE INDEX "registration_email_challenges_proof_hash_key" ON "registration_email_challenges"("proof_hash");
CREATE INDEX "registration_email_challenges_email_created_at_idx" ON "registration_email_challenges"("email", "created_at");
CREATE INDEX "registration_email_challenges_expires_at_idx" ON "registration_email_challenges"("expires_at");
CREATE INDEX "registration_email_challenges_created_at_idx" ON "registration_email_challenges"("created_at");
COMMIT;
