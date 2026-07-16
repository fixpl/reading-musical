# 리딩뮤지컬 공연 기획·연출 관리 시스템 (아트브릿지)

리딩뮤지컬 공연을 **신청 → 제작(대본·캐스팅·큐시트) → 리허설·진행**까지 한곳에서 관리하는 SaaS입니다.

- `backend/` — NestJS REST API · Prisma · PostgreSQL (DB는 snake_case, Prisma Client는 camelCase)
- `frontend/` — SvelteKit · Tailwind v4 · shadcn-svelte
- 패키지 매니저는 **pnpm** 기준입니다.

---

## 빠른 시작

### 0. 사전 준비

- **Node.js 20+**, **pnpm** (`npm i -g pnpm`)
- **PostgreSQL 14+** 실행 중 + 빈 데이터베이스 하나 (기본 이름 `musical`)
  ```bash
  createdb musical      # 또는 psql에서: CREATE DATABASE musical;
  ```

### 1. 백엔드 — http://localhost:3000

```bash
cd backend
cp .env.example .env          # DATABASE_URL 등 확인 (기본: postgres:password@localhost:5432/musical)
pnpm install
pnpm prisma:generate          # Prisma Client 생성
pnpm prisma:deploy            # 마이그레이션 적용
pnpm prisma:seed              # 테스트 계정·샘플 공연 시드 (아래 표)
pnpm start:dev                # 개발 서버(watch)
```

### 2. 프론트엔드 — http://localhost:5179

```bash
cd frontend
cp .env.example .env          # PUBLIC_API_BASE_URL이 백엔드(http://localhost:3000/api/v1)를 가리키는지 확인
pnpm install
pnpm dev --port 5179
```

→ 브라우저에서 **http://localhost:5179** 접속. (백엔드를 먼저 띄운 뒤 프론트를 실행하세요.)

> **포트가 맞아야 붙습니다.** 프론트 `.env`의 `PUBLIC_API_BASE_URL`은 백엔드(3000)를 가리키고, 백엔드 `.env`의 `CORS_ORIGINS`에는 프론트 주소(`http://localhost:5179`)가 있어야 합니다 — `.env.example`에 기본 포함되어 있습니다. 포트를 바꿀 땐 코드가 아니라 이 두 `.env`만 고칩니다.
>
> **AI 대본 초안** 기능을 쓰려면 `backend/.env`의 `LLM_API_KEY`(Google AI Studio 키 등)를 채웁니다. 비워두면 그 기능만 안내와 함께 비활성화됩니다.

---

## 테스트 계정으로 둘러보기

`pnpm prisma:seed`(backend)가 아래 계정과 `아트브릿지 운영단체`의 샘플 공연·배역·일정·큐시트를 만듭니다.

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

> 큐시트 타임라인 등 편집 화면은 PC 화면 기준입니다. 배우·스태프의 확인용 화면(홈·일정·대본 보기)은 모바일에 맞춰져 있습니다.

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
pnpm qa:release          # DB를 변경하지 않는 Prisma·PRD·API 경계·build 검증
pnpm qa:release:full     # 로컬 DB migration + backend/frontend 자동 기동 + API·화면 스모크
pnpm backend:prisma:status # 현재 DATABASE_URL의 migration 적용 상태 확인
```

운영 배포 환경 변수는 `backend/.env.production.example`, `frontend/.env.production.example`을 기준으로 배포 플랫폼의 Secret/Env에 등록합니다. 운영 migration은 push CI가 아니라 DB 백업 후 별도 release 단계에서 `pnpm backend:prisma:deploy`로 적용합니다.

자세한 절차는 [docs/runbook/release.md](docs/runbook/release.md). 제품 요구사항·화면정의는 [PRD.md](PRD.md), 개편 방향은 [docs/redesign-plan.md](docs/redesign-plan.md).

---

## 핵심 원칙

- 프론트는 DB/Prisma에 직접 접근하지 않고 `/api/v1` REST 계약만 사용합니다(`frontend/src/lib/api/client.ts` 경계).
- 환경 변경은 코드가 아니라 `.env`로 처리합니다(프론트 `PUBLIC_API_BASE_URL`·`PUBLIC_WS_URL`, 백엔드 `CORS_ORIGINS`·`PORT`·`API_PREFIX`). 운영에서는 placeholder secret·와일드카드 CORS 등을 기동 시 거부합니다.
- 메일은 요청 중 직접 발송하지 않고 아웃박스에 적재한 뒤 `mail:worker`가 보냅니다.
- API breaking change는 `/api/v2`에서만, `/api/v1`은 optional 필드 추가로 확장합니다.
