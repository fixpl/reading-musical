# 리딩뮤지컬 공연 기획·연출 관리 시스템 (아트브릿지)

리딩뮤지컬 공연을 **신청 → 제작(대본·캐스팅·큐시트) → 리허설·진행**까지 한곳에서 관리하는 SaaS입니다.

- `backend/` — NestJS REST API · Prisma · PostgreSQL (DB는 snake_case, Prisma Client는 camelCase)
- `frontend/` — SvelteKit · Tailwind v4 · shadcn-svelte
- 설치·검사는 저장소의 `package-lock.json`과 기존 npm 스크립트를 기준으로 **npm**을 사용합니다. 검사는 설치된 Node CLI를 직접 호출하며, 별도 패키지 매니저 다운로드나 중첩 npm 셸 실행이 필요하지 않습니다.

---

## 빠른 시작

### 0. 사전 준비

- **Node.js 22 LTS**, Node.js에 포함된 **npm**
- **PostgreSQL 14+** 실행 중 + 빈 데이터베이스 하나 (기본 이름 `musical`)
  ```bash
  createdb musical      # 또는 psql에서: CREATE DATABASE musical;
  ```

### 1. 백엔드 — http://localhost:3000

```bash
cd backend
cp .env.example .env          # DATABASE_URL 등 확인 (기본: postgres:password@localhost:5432/musical)
npm ci
npm run prisma:generate          # Prisma Client 생성
npm run prisma:deploy            # 마이그레이션 적용
npm run prisma:seed              # 테스트 계정·샘플 공연 시드 (아래 표)
npm run start:dev                # 개발 서버(watch)
```

### 2. 프론트엔드 — http://localhost:5179

```bash
cd frontend
cp .env.example .env          # PUBLIC_API_BASE_URL이 백엔드(http://localhost:3000/api/v1)를 가리키는지 확인
npm ci
npm run dev -- --port 5179
```

→ 브라우저에서 **http://localhost:5179** 접속. (백엔드를 먼저 띄운 뒤 프론트를 실행하세요.)

> **포트가 맞아야 붙습니다.** 프론트 `.env`의 `PUBLIC_API_BASE_URL`은 백엔드(3000)를 가리키고, 백엔드 `.env`의 `CORS_ORIGINS`에는 프론트 주소(`http://localhost:5179`)가 있어야 합니다 — `.env.example`에 기본 포함되어 있습니다. 포트를 바꿀 땐 코드가 아니라 이 두 `.env`만 고칩니다.
>
> **AI 대본 초안**은 OpenAI JavaScript SDK로 NVIDIA의 OpenAI 호환 API를 호출합니다. 서버 Secret/Env에 `NVIDIA_API_KEY`를 설정합니다. 기본 모델은 `deepseek-ai/deepseek-v4-pro-0813`이며 아래 환경설정으로 변경할 수 있습니다. 기존 `LLM_BASE_URL`·`LLM_MODEL`에 다른 공급자가 지정되어 있다면 함께 변경해야 합니다. 키를 프론트엔드나 저장소에 넣지 마세요.

---

## 테스트 계정으로 둘러보기

`npm run prisma:seed`(backend)가 아래 계정과 `아트브릿지 운영단체`의 샘플 공연·배역·일정·큐시트를 만듭니다.

| 역할 | 이메일 | 비밀번호 | 로그인 후 |
| --- | --- | --- | --- |
| 운영 관리자(SUPER_ADMIN) | `admin@example.com` | `change-me-strong` | `/admin` — 콘솔 + 모든 공연 워크스페이스 전권 |
| 배우 | `actor@example.com` | `change-me-strong` | `/app` — 내 공연·개인/공연 일정·대본·큐시트 확인 + 출석 응답 + 담당 트랙 큐 편집 |
| 스태프 | `staff@example.com` | `change-me-strong` | `/app` — 배우와 같은 기본 기능 + 담당 트랙 큐 편집 |

> 시드 계정·비밀번호는 `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ACTOR_EMAIL`, `SEED_STAFF_EMAIL`, `SEED_DEMO_PASSWORD`로 바꿀 수 있습니다.

### 역할별로 이렇게 해보세요

- **운영 관리자** (`/admin`)
  - **공연 신청 문의**: 랜딩(`/`)에서 로그인 없이 신청 폼을 제출한 뒤, 여기서 접수 확인 → 상태 변경 → **공연으로 전환**.
  - **회원 관리**: 회원 목록·상세(참여 공연·다가오는 일정·차단)를 한 화면에서 확인.
  - **공연 관리**: 공연마다 대본 편집·캐스팅·멤버·공연 설정·큐시트를 **전권**으로. 잘못 만든 대본·큐는 **삭제(소프트) 후 복구** 가능.
- **배우·스태프 공통** (`/app`)
  - 첫 화면에서 **내 공연**·다가오는 일정(참석/불참 응답)·알림 확인.
  - 공연을 열어 대본·전체 큐시트·공연 일정·참여자·소통 내용을 확인합니다.
  - **내 일정**에서 회사 근무, 다른 공연, 병원 예약 같은 개인 일정을 직접 등록·수정·삭제합니다. 개인 내용은 본인만 보고, 제작진이 공연 일정을 잡을 때는 시간 충돌 여부만 표시됩니다.
  - 공연 일정에 배정되면 개인 일정과 다른 공연 일정까지 함께 충돌 검사되며, 강제 배정은 제작진의 사유와 알림을 남깁니다.
- **담당 트랙이 있는 배우·스태프** (`/app`)
  - 담당 공연 큐시트에서 **"내 큐만"**으로 본인 트랙(예: 배우 동선·조명·음향)을 편집합니다. 나머지 트랙은 전체 흐름 파악을 위한 맥락으로 함께 봅니다.
  - 샘플 데이터에서는 배우에게 `배우`, 스태프에게 `효과음` 트랙이 배정됩니다.

### 한 바퀴 흐름

1. 랜딩(`/`)에서 **공연 신청 폼** 제출 (로그인 불필요)
2. **관리자**로 `/admin/inquiries`에서 접수 → **공연으로 전환**
3. 관리자가 공연 워크스페이스에서 **대본 등록**(큐시트 "AI 초안" 또는 대본 편집) + **멤버·캐스팅** 지정
4. **배우·스태프**로 로그인해 본인 공연·일정·큐 확인

> 기존 큐시트 스튜디오는 PC용 편집 화면입니다. 실제 시간 기준의 개인 연습과 터치/숫자 입력 시간 수정은 `/app/p/[pid]/live`의 **개인 연습 · 시간표**를 사용합니다. 두 화면은 같은 대본/큐를 저장하지만 기존 스튜디오의 큐 도형 배치는 실제 시작 시각을 반영하는 정밀 재생 화면이 아닙니다.

---

## 화면 구조

| 영역 | 경로 | 대상 |
| --- | --- | --- |
| 공개 랜딩 | `/` | 외부 기관 — 공연 소개·신청 폼 (로그인 불필요) |
| 인증 | `/login`, `/register`, `/forgot`, `/reset` | 로그인 후 역할에 따라 `/admin` 또는 `/app`으로 분기 |
| 참여자 앱 | `/app`, `/app/schedule`, `/app/notifications`, `/app/profile` | 배우·스태프 — 내 공연·내 일정(달력)·알림·프로필 |
| 공연 워크스페이스 | `/app/p/[pid]` 및 하위 `cuesheet`·`script`·`schedule`·`people`·`board`·`manage/*` | 개요·큐시트·대본·일정·참여자·소통, 제작 관리(대본 편집·캐스팅·멤버·설정) |
| 운영 콘솔 | `/admin`, `/admin/inquiries`, `/admin/members`, `/admin/productions` | 운영자 — 대시보드·문의 인박스·회원·공연 관리 |

- 운영자(SUPER_ADMIN 전역 · ORG_ADMIN 소속 조직)는 공연 멤버가 아니어도 담당 공연 워크스페이스를 전권으로 씁니다. 배우·스태프는 본인 공연에서 확인 + 자기 큐·일정·프로필만 정리합니다.
- 삭제(공연·대본·큐)는 **소프트 삭제**입니다 — 실제 데이터는 지우지 않고 감췄다가 복구합니다.
- 전체 API 계약은 서버 실행 후 Swagger `/api/docs`, OpenAPI JSON `/api-json`에서 확인합니다.

---

## 자동 검증 (선택)

루트에서 서버 없이 도는 정적 게이트와, 서버를 띄워 도는 통합 스모크가 있습니다.

```bash
npm run qa:release          # DB를 변경하지 않는 Prisma·PRD·API 경계·build 검증
npm run qa:release:full     # 로컬 DB migration + backend/frontend 자동 기동 + API·화면 스모크
npm run backend:prisma:status # 현재 DATABASE_URL의 migration 적용 상태 확인
```

운영 배포 환경 변수는 `backend/.env.production.example`, `frontend/.env.production.example`을 기준으로 배포 플랫폼의 Secret/Env에 등록합니다. 운영 migration은 push CI가 아니라 DB 백업 후 별도 release 단계에서 `npm run backend:prisma:deploy`로 적용합니다.

자세한 절차는 [docs/runbook/release.md](docs/runbook/release.md). 제품 요구사항·화면정의는 [PRD.md](PRD.md), 개편 방향은 [docs/redesign-plan.md](docs/redesign-plan.md).

---

## 핵심 원칙

- 프론트는 DB/Prisma에 직접 접근하지 않고 `/api/v1` REST 계약만 사용합니다(`frontend/src/lib/api/client.ts` 경계).
- 환경 변경은 코드가 아니라 `.env`로 처리합니다(프론트 `PUBLIC_API_BASE_URL`·`PUBLIC_WS_URL`, 백엔드 `CORS_ORIGINS`·`PORT`·`API_PREFIX`). 운영에서는 placeholder secret·와일드카드 CORS 등을 기동 시 거부합니다.
- 메일은 요청 중 직접 발송하지 않고 아웃박스에 적재한 뒤 `mail:worker`가 보냅니다.
- API breaking change는 `/api/v2`에서만, `/api/v1`은 optional 필드 추가로 확장합니다.

## 2026-09 공연 시간표 · 개인 연습

### 배포 전 데이터베이스 변경

`20260907180000_track_cue_start_time` migration은 `track_cues.start_ms` nullable 열과 범위 제약을 추가합니다. 기존 큐 시간을 추측해서 채우거나 기존 데이터를 삭제하지 않습니다. **소스 변경이나 `check` 실행은 DB migration 적용이 아닙니다.** 배포 전 백업 후 기존 release 절차에서 `npm run backend:prisma:deploy`를 실행하고 백엔드를 재기동합니다.

### NVIDIA 환경설정 (서버 전용)

```dotenv
NVIDIA_API_KEY=<서버의 Secret에 등록>
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=deepseek-ai/deepseek-v4-pro-0813
LLM_TEMPERATURE=1
LLM_TOP_P=0.95
LLM_MAX_TOKENS=16384
LLM_SEED=42
LLM_TIMEOUT_MS=180000
LLM_MAX_RETRIES=2
LLM_JSON_MODE=false
LLM_EXTRA_BODY_JSON={"chat_template_kwargs":{"thinking":false}}
```

모델을 바꾸면 해당 모델에서 지원하는 추가 옵션도 확인합니다. `LLM_EXTRA_BODY_JSON={}`로 추가 옵션을 끌 수 있습니다. JavaScript SDK에서는 이 객체를 요청 최상위에 펼칩니다(Python 예제의 `extra_body` 래퍼를 그대로 보내지 않음). 다른 공급자를 명시적으로 사용할 때는 `NVIDIA_API_KEY`를 제거하고 `LLM_API_KEY`와 해당 `LLM_BASE_URL`을 설정합니다. 키를 다른 공급자로 잘못 보내는 조합은 거부합니다. 설정 변경은 서버 환경설정/재기동 방식이며 관리자 화면에서 Secret을 편집하지 않습니다.

### 대본 시간 규칙

시간은 날짜/시각이 아니라 **공연 시작 기준 경과시간**입니다. `MM:SS`, `HH:MM:SS`, 소수점 밀리초와 `[00:03.500 --> 00:07.000]` 범위를 지원합니다. 예:

```text
[00:00 --> 00:05] 해설자: 오늘의 이야기를 시작합니다.
[00:05.000 --> 00:09.500] 배우: 안녕하세요.
[00:09.500] 조명 암전
```

서버가 원문 시간부터 해석하고 AI에는 원문 행 번호를 전달합니다. 반환된 대사는 원문 행과 연결해 시간을 복원하므로 모델이 추측한 시작 시각으로 덮어쓰지 않습니다. 시간표시 유무에 관계없이 내용이 있는 원문 행이 누락·중복되거나 출력 길이 제한/부분 분석 실패가 발생하면 적용 가능한 결과를 반환하지 않습니다. 막·장면 제목은 메모, 무대 지시는 지문으로도 보존하며 큐 요약만으로 원문 대사를 대체하지 않습니다. 분석은 NDJSON 진행 응답 방식이며, 연결이 끊기면 공급자 요청을 취소합니다. 백그라운드 영속 작업 큐/재접속 복구는 아직 제공하지 않습니다.

시간 없는 대사/큐는 `null`로 저장하며 화면에서 자동/추정 배치로 구분합니다. 기본 대사 길이는 8초, 큐는 30초입니다. 확정 시간으로 간주하지 마세요. **시간 수정**에서 시작/길이를 지정하거나 빈 값으로 돌릴 수 있습니다. 큐 길이는 정수 초, 대사 길이는 밀리초로 저장됩니다. AI 재분석은 새 대본 또는 명시적 이어붙이기이며 기존 수동 수정 대본을 자동으로 교체하지 않습니다. 여러 대본은 연습 화면에서 하나를 선택합니다.

### 운영 단계와 권한

1단계는 단일 슈퍼관리자의 공연·회원 운영입니다. 회원의 배우/스태프 프로필과 공연별 배역·업무 권한은 구분합니다. 향후 여러 기획사로 확장할 수 있도록 `Organization`과 공연별 멤버십·역할을 유지하며, 단체 관리자와 조직 데이터를 단일 전역 권한으로 합치지 않습니다. 기획사 셀프 가입·결제·플랜과 전체 권한 경계 통합 검증은 이번 시간표 보완의 완료 범위가 아닙니다.

### 화면과 재생 범위

운영 홈은 공연·회원·문의와 공연별 참여자/일정/대본/연습 바로가기를 제공합니다. 참여자 화면에는 모바일 하단 탐색과 안전영역 여백을 적용했고 내 일정은 목록 기본 보기, 개인 일정 표시, 스크롤 가능한 편집 창을 제공합니다. 공연 일정은 시작일·종료일을 따로 입력하고, 자정을 넘거나 여러 날짜에 걸쳐도 해당 날짜들에 표시합니다. 종료 시각은 포함하지 않아 자정에 끝나는 일정이 다음 날까지 중복 표시되지 않습니다. 진행 중인 다일 일정은 오늘 목록에서 확인합니다.

`/app/p/[pid]/live`는 개인 재생·일시정지·시점 이동·배속·선택 장면 반복·배역 강조와 시간표 숫자 편집을 제공합니다. 기존 공연 배경 영상 및 각 큐에 연결된 PNG/JPG/WebP 이미지, 영상, 음원을 시간표에 맞춰 표시/재생합니다. 미디어 소리는 기본 꺼짐이며 사용자가 켭니다. 실제 지원 코덱, 자동재생 권한, 업로드·signed URL 상태는 사용하는 브라우저에서 검증해야 합니다.

**전체화면 출력은 로그인한 기기의 배경과 대사/가사 표시**입니다. 스태프 지시/메모는 표시하지 않습니다. 외부 관객에게 공개된 공유 링크가 아니며, 음성인식 자동 추종이나 여러 기기 동시 공연 제어도 아닙니다. 관객용 배포와 접근성 확정은 자막/효과음 설명/미디어 내용 검수 및 별도의 공개 범위 설계가 필요합니다. 개인 연습은 공유 reading-session/WebSocket 상태를 수정하지 않습니다.

### 검증

`npm run check`는 Prisma validate/generate, Nest 빌드, Svelte 타입 검사를 수행합니다(DB migration/seed 없음). `npm run test`는 Prisma Client 생성과 백엔드 빌드 후 기존 Jest 테스트 및 NVIDIA 설정, AI 시간 필드 보존, 원문 누락·중복 거부, 시간 범위, 다일 달력, 조직관리자 범위를 오프라인 검사합니다. 변경한 일정·개인 연습 화면의 Svelte 클라이언트/서버 문법 컴파일도 포함합니다. **문법 컴파일은 전체 프론트 타입 검사나 브라우저 테스트가 아닙니다.** `npm run build`는 백엔드·프론트 배포 빌드입니다.

품질 검사에 사용하는 Prisma URL은 검증/Client 생성만을 위한 비운영 자리표시자입니다. migration/seed 명령에는 적용하지 않습니다. 실행 환경이 `frontend/.env` 읽기를 거부하면 SvelteKit/Vite 전체 검사와 빌드는 중단됩니다. 이 실패를 통과로 간주하거나 비밀파일 보호를 해제하지 마세요. 실제 NVIDIA 키 호출, DB migration 적용, iOS/Android 미디어 재생과 자막 동기화, 초대·권한 전체 API 검증은 배포 전 별도로 확인해야 합니다.
