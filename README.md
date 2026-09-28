# 아트브릿지 · Reading Musical

**대본의 첫 줄부터, 무대의 마지막 큐까지.**

리딩뮤지컬 팀이 공연·참여자·대본·일정·큐시트·개인 연습을 한곳에서 준비하는 공연 관리 플랫폼입니다. 현재는 슈퍼관리자가 공연과 회원을 운영하고, 배우·스태프가 배정된 공연에 참여하는 단계입니다. 기획사별 셀프 가입·결제 서비스는 아직 제공하지 않습니다.

```text
공연 생성 → 배우·스태프 배정 → 대본·캐스팅·큐시트 준비 → 공동 일정 → 개인 연습·리허설
```

공개 메인(`/`)에서는 실제 계정 데이터와 분리된 타임라인·공동 일정·참여자 예시, 기능 소개, 역할별 이용 흐름과 공연 문의를 제공합니다. 실제 공연은 로그인 후 이용합니다.

## 로컬에서 시작하기

이미 의존성·개발용 환경설정·DB가 준비되어 있다면 루트에서 실행합니다.

```sh
sh dev.sh
# 또는 npm run dev
```

기본 접속 주소는 아래와 같습니다. 로그인·쿠키 테스트 시 실행기가 안내한 `127.0.0.1` 주소를 사용하고 `localhost`와 섞지 않습니다.

| 용도 | 기본 주소 |
| --- | --- |
| 서비스 소개 메인 | `http://127.0.0.1:5179` |
| 로그인 | `http://127.0.0.1:5179/login` |
| 백엔드 REST API | `http://127.0.0.1:3000/api/v1` |
| API 문서 / OpenAPI | `http://127.0.0.1:3000/api/docs` / `/api-json` |
| DB 포함 준비 상태 | `http://127.0.0.1:3000/health/ready` |

### 처음 실행하는 경우

macOS 또는 Linux, Node.js 22 이상, npm, `lsof`, 실행 중인 PostgreSQL과 **개발용 데이터베이스**가 필요합니다. 실행기는 PostgreSQL 설치·DB 생성·패키지 설치를 대신하지 않습니다.

```sh
# 루트에서 의존성 설치 — 기존 lockfile 사용
npm ci
npm --prefix backend ci
npm --prefix frontend ci

# 기존 backend/.env가 없을 때만 복사한 뒤 개발용 DB·JWT 설정 입력
cp -n backend/.env.example backend/.env

# PostgreSQL에 개발용 DB가 없으면 먼저 생성
# createdb musical

# 최초 실행 또는 새 migration이 있을 때만: 개발 DB에 기존 migration 적용 후 기동
sh dev.sh dev --migrate
```

`backend/.env`의 `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`을 확인합니다. 운영·스테이징 설정은 실행기가 거부합니다. **로컬 실행은 앱을 이 PC에서 실행한다는 뜻이며, 개발 DB까지 같은 PC에 있을 필요는 없습니다.** 외부 서버의 개발 DB는 아래와 같이 명시적으로 허용합니다. 운영 DB나 운영 DB 터널에는 사용하지 마세요.

### 개발 DB가 다른 서버에 있는 경우

기존 `DATABASE_URL`이 개발 전용 DB를 가리키는지 확인한 뒤 실행합니다. DB 주소나 비밀번호를 채팅에 붙여 넣을 필요는 없습니다.

```sh
# 서버 시작·데이터 변경 없이 연결과 migration 상태 확인
sh dev.sh check --allow-remote-db

# 원격 개발 DB를 사용하면서 백엔드·프론트는 이 PC에서 실행
sh dev.sh --allow-remote-db
```

매번 옵션 없이 `sh dev.sh`로 실행하려면 `backend/.env`에 `DEV_ALLOW_REMOTE_DB=true`를 설정합니다. 터미널에 export한 동일 이름의 환경변수가 있으면 파일보다 우선합니다. DB 주소를 `localhost`로 억지로 바꿀 필요는 없습니다.

허용 옵션은 DB를 읽기 전용으로 만드는 기능이 아닙니다. 앱에서 저장·수정한 데이터는 설정된 DB에 반영됩니다. **원격 DB의 `--migrate`는 실행기에서 차단**하며, 필요한 스키마 적용은 대상 DB를 확인한 별도 절차로 진행합니다.

통합 실행에서는 프론트의 API·WebSocket 주소와 백엔드 포트·CORS를 함께 맞추므로 `frontend/.env`는 선택 사항입니다. 이미 있는 환경 파일은 덮어쓰지 않습니다. AI 공급자 키가 없어도 일반 공연·일정 화면을 사용할 수 있으나, AI 분석은 서버 키 설정이 필요합니다.

## 통합 실행 명령

| 명령 | 동작 |
| --- | --- |
| `sh dev.sh` | 백엔드 watch + 프론트 개발 서버 실행 |
| `sh dev.sh check` | 설정·의존성 경로·DB 연결·migration 상태 확인. 서버 기동/포트 종료/DB 변경 없음 |
| `sh dev.sh --allow-remote-db` | 원격 개발 DB 사용을 명시적으로 허용. `check`·`preview`에도 같은 옵션 사용 가능 |
| `sh dev.sh dev --migrate` | 로컬 개발 DB에 기존 migration 적용 후 개발 서버 실행 |
| `sh dev.sh preview` | 프론트·백엔드 빌드 후 로컬 미리보기. 운영 배포 명령 아님 |
| `sh dev.sh --help` | 옵션 안내 |

포트를 바꿀 때는 두 서버의 연결 설정도 함께 반영됩니다.

```sh
DEV_BACKEND_PORT=3001 DEV_FRONTEND_PORT=5180 sh dev.sh
```

실행기는 사전 검사 후 이전 통합 실행기를 확인해 종료하고 지정 포트를 비웁니다. **선택한 포트를 사용하는 다른 프로그램도 종료될 수 있으므로 개발 전용 포트를 사용하세요.** DB와 같은 포트는 거부하며, 모든 Node 프로세스를 일괄 종료하지 않습니다. 직접 실행해 둔 watch 프로세스가 포트를 계속 재점유하면 원래 터미널에서 종료해야 합니다. 실행 후 `Ctrl+C`로 두 서버를 함께 정리합니다.

일반 기동은 migration 상태만 확인합니다. 자동 reset·seed·패키지 설치는 없고, migration은 로컬 DB에서 `--migrate`를 명시해야 적용합니다. 메일은 로컬 실행 시 `json` transport로 설정해 실제 발송하지 않으며 메일/출석 리마인더 worker는 자동으로 실행하지 않습니다.

## 주요 화면과 역할

| 화면 | 경로 | 역할 |
| --- | --- | --- |
| 프로그램 소개 | `/` | 공개 예시·기능·이용 흐름·공연 문의 |
| 운영 콘솔 | `/admin` | 회원·공연·문의 관리 |
| 참여자 홈 | `/app` | 배정된 공연·알림·일정 |
| 내 일정 | `/app/schedule` | 개인 일정·공연 일정·출석 응답 |
| 공연 워크스페이스 | `/app/p/[pid]` | 대본·큐시트·일정·참여자·소통 |
| 개인 연습·시간표 | `/app/p/[pid]/live` | 재생·시점 이동·장면 반복·시간 수정·전체화면 |

회원의 기본 프로필과 공연별 배역·업무 권한은 구분합니다. 슈퍼관리자는 전체 공연, 조직관리자는 소속 조직 범위에서 운영합니다. 배우·스태프는 배정된 공연을 보고 권한이 있는 담당 트랙을 편집합니다. 상세 권한과 테스트 계정 준비는 `DEVELOPMENT.md`를 참고하세요.

## 저장소 구조

```text
backend/                 NestJS API · Prisma · PostgreSQL
  src/schedule/          공동/개인 일정, 충돌·출석·리마인더
  src/cue-sheet/         큐 트랙·시간·담당 권한
  src/ai/                대본 분석·원문 시간 보존
  prisma/migrations/     버전 관리되는 DB 변경
frontend/                SvelteKit · Svelte 5 · Tailwind 4
  src/routes/+page.svelte 프로그램 소개 메인
  src/lib/components/landing/  예시 화면·공연 문의 폼
  src/lib/domain/        타임라인·달력 계산
scripts/local-dev.mjs    로컬 설정 검사·두 서버 실행/종료
 dev.sh                 루트 실행 진입점
 tests/run-quality.cjs  공통 검사 실행기
 tests/smoke/           타임라인·로컬 실행기 회귀검사
DEVELOPMENT.md           환경설정·DB·테스트·문제 해결·배포 경계
```

프론트는 Prisma/DB에 직접 접근하지 않고 `/api/v1` REST 계약을 사용합니다. API 키·DB 비밀번호는 서버 환경설정에만 저장합니다. 공개 예시 컴포넌트는 실제 공연 데이터나 공유 리딩 세션을 변경하지 않습니다.

## 검사

```sh
npm run test       # 백엔드 단위검사 + 타임라인·달력·로컬 실행기 회귀검사
npm run check      # Prisma 검증/생성 + 백엔드 빌드 + 전체 Svelte 타입 검사
npm run build      # 백엔드·프론트 배포 빌드
npm run dev:check  # 실제 로컬 설정·DB 연결·migration 상태 검사
```

`test`, `check`, `build`의 Prisma validate/generate는 DB 변경 없이 수행합니다. `dev:check`는 설정된 개발 DB 연결을 확인하지만 migration을 적용하지 않습니다. 원격 개발 DB는 `npm run dev:check -- --allow-remote-db`로 허용할 수 있습니다. 두 종류의 검사를 혼동하지 마세요.

### 2026-09-08 작업 검증 기록

백엔드 Jest **4개 suite / 16개 테스트**, 로컬 실행기 **9개 테스트**, 타임라인·AI 원문 보존·다일 달력·조직 권한 회귀검사가 통과했습니다. Svelte **5개 화면/컴포넌트의 client/server 문법 컴파일은 경고 0개**였고 Prisma schema 검증과 백엔드 빌드도 통과했습니다.

전체 `check`와 `build`는 검사 환경에서 `frontend/.env`를 읽을 수 없는 `EPERM`으로 종료 코드 1을 반환했습니다. **전체 프론트 타입 검사·배포 빌드·브라우저 실행을 통과한 상태로 간주하지 않습니다.** 실제 DB 연결과 migration 적용 상태, 서버 재기동·포트 정리, 실제 기기 미디어 재생도 이번 자동 검사에서 확인하지 않았습니다. 비밀파일 보호를 해제하거나 우회하지 말고, 권한이 있는 개발 터미널에서 해당 검사를 별도로 실행해야 합니다.

운영 배포는 `dev.sh`로 하지 않습니다. DB 백업, 운영 환경설정, 별도 migration 단계와 release 검증 절차는 `DEVELOPMENT.md`에 정리했습니다.
