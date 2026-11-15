-- Additive migration. Published legal texts and existing consent history are never fabricated.
ALTER TABLE "users" ADD COLUMN "marketing_privacy" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketing_email" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketing_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "marketing_updated_at" TIMESTAMP(3);
CREATE TABLE "legal_documents" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT '', "items" TEXT NOT NULL DEFAULT '',
  "retention" TEXT NOT NULL DEFAULT '', "refusal" TEXT NOT NULL DEFAULT '',
  "effective_at" TIMESTAMP(3) NOT NULL, "published_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");
CREATE INDEX "legal_documents_kind_effective_at_published_at_idx" ON "legal_documents"("kind", "effective_at", "published_at");
CREATE TABLE "consent_events" (
  "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "granted" BOOLEAN NOT NULL,
  "document_id" TEXT, "source" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consent_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "consent_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "consent_events_user_id_created_at_idx" ON "consent_events"("user_id", "created_at");
ALTER TABLE "inquiries" ADD COLUMN "privacy_document_id" TEXT, ADD COLUMN "privacy_consented_at" TIMESTAMP(3);
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_privacy_document_id_fkey" FOREIGN KEY ("privacy_document_id") REFERENCES "legal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "faq_categories" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "faq_categories_name_key" ON "faq_categories"("name");
CREATE TABLE "faq_questions" (
  "id" TEXT PRIMARY KEY, "category_id" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "faq_questions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "faq_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "faq_questions_category_id_active_order_idx" ON "faq_questions"("category_id", "active", "order");
CREATE TABLE "support_tickets" (
  "id" TEXT PRIMARY KEY, "user_id" TEXT, "guest_key_hash" TEXT,
  "contact_name" TEXT NOT NULL, "email" TEXT NOT NULL, "category" TEXT NOT NULL,
  "subject" TEXT NOT NULL, "message" TEXT NOT NULL, "answer" TEXT, "internal_note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN', "revision" INTEGER NOT NULL DEFAULT 1,
  "privacy_document_id" TEXT NOT NULL, "privacy_consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answered_at" TIMESTAMP(3), "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_tickets_privacy_document_id_fkey" FOREIGN KEY ("privacy_document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");
CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");
CREATE INDEX "support_tickets_expires_at_idx" ON "support_tickets"("expires_at");
-- Move the existing landing FAQ into editable database records.
INSERT INTO "faq_categories" ("id", "name", "order", "updated_at") VALUES
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc446', '가입·참여', 10, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc447', '연습·운영', 20, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc448', '기기·접근', 30, CURRENT_TIMESTAMP);
INSERT INTO "faq_questions" ("id", "category_id", "title", "body", "order", "updated_at") VALUES
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc451', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc446', '누구나 가입할 수 있나요?', '배우·스태프·연출 등 활동 직군을 고르고 가입할 수 있습니다. 현재 가입 경로는 만 14세 이상을 대상으로 하며, 운영팀이 배정하거나 초대한 공연만 볼 수 있습니다.', 10, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc452', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc446', '공연은 어떻게 정해지나요?', '운영팀이 진행 중인 공연의 배역·담당 자리와 프로필, 가능한 일정을 보고 맞는 곳에 연결합니다.', 20, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc453', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc446', '여러 공연에 동시에 참여해도 되나요?', '공연마다 역할이 따로 정해지고 홈에는 참여 중인 공연이 모두 나옵니다. 일정이 겹치면 배정 시 충돌로 알려 드립니다.', 30, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc454', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc448', '휴대폰에서도 쓸 수 있나요?', '휴대폰 브라우저와 홈 화면에 설치한 앱으로 이용할 수 있습니다. 연습·일정·메모는 모바일에서도 사용할 수 있으며, 타임라인 편집은 PC를 권장합니다.', 10, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc455', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc447', '연습하며 남긴 메모는 누가 볼 수 있나요?', '나만 보기 메모는 본인만, 팀에 공유한 메모는 해당 공연 참여자들이 볼 수 있습니다. 메모는 남긴 시점에 연결됩니다.', 10, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc456', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc447', '대본이나 영상이 없으면 연습할 수 없나요?', '운영팀이 공연에 대본과 영상을 올려 두면 참여자는 따로 준비 없이 연습할 수 있습니다. 자료가 없으면 운영팀에 등록을 요청해 주세요.', 20, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc457', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc447', '대본 정리는 AI가 해 주나요? 영상 내용도 보나요?', '대본 파일에서 AI가 장면·배역·큐 초안을 만들고 사람이 확인한 뒤 등록합니다. 원문에 시간이 없으면 추정값으로 표시합니다. 영상은 파일명과 장면 내용을 바탕으로 추천하며 최종 선택은 사람이 합니다.', 30, CURRENT_TIMESTAMP),
('9dcb5058-27a9-44cd-8bf8-f5b74c5dc458', '9dcb5058-27a9-44cd-8bf8-f5b74c5dc448', '전체화면 출력은 관객용 공개 링크인가요?', '로그인한 기기에서 대사·가사와 배경을 크게 보여 주는 기능입니다. 외부 관객용 링크나 여러 기기 동시 제어는 제공하지 않습니다.', 20, CURRENT_TIMESTAMP);
