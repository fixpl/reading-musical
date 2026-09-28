# 개발·DB·검증 가이드

이 문서는 루트 `README.md`의 상세 안내입니다. 기본 개발 흐름은 `sh dev.sh`이며 운영 배포와 구분합니다. 현재 구현은 NestJS/Prisma 백엔드와 SvelteKit 프론트입니다. 기존 Python 예시와 달리 이 저장소의 AI 호출은 OpenAI JavaScript SDK를 사용합니다.

## 1. 로컬 실행기의 범위

`dev.sh`는 위치에 관계없이 저장소 루트를 찾아 `scripts/local-dev.mjs`를 실행하는 POSIX sh 진입점입니다. `sh dev.sh` 또는 `npm run dev`로 실행하므로 실행 권한 변경이 필요하지 않습니다. macOS/Linux에서 Node.js 22 이상과 `lsof`가 필요합니다.

```sh
sh dev.sh                    # 개발 watch 서버 2개
sh dev.sh check              # 데이터 변경 없는 사전 검사
sh dev.sh dev --migrate      # 개발 DB migration 적용을 명시적으로 요청
sh dev.sh preview            # 로컬 빌드 미리보기 — 운영 환경 아님
sh dev.sh check --allow-remote-db  # 원격 개발 DB 사전 검사
sh dev.sh --allow-remote-db        # 원격 개발 DB + 로컬 앱 실행
```

기동 순서는 설정·필수 CLI 경로 검사 → Prisma schema 검증 → DB `SELECT 1` → 선택적 migration 적용 → migration 상태 확인 → Client 생성 → 이전 실행기/선택 포트 정리 → 백엔드 시작 → `/health/ready` 확인 → 프론트 시작 → 메인 응답 확인입니다. `preview`는 포트 정리 전에 두 프로젝트를 빌드합니다. `check`는 Client 생성·포트 정리·서버 시작 전에 끝납니다.

DB 연결, migration 상태, 빌드 또는 준비 상태 확인이 실패하면 성공 메시지 없이 중단합니다. 이 실행기가 시작한 서버 중 하나가 종료되면 다른 서버도 정리합니다. `Ctrl+C`·종료 신호 역시 이 실행기가 소유한 자식 프로세스 그룹을 정리합니다.

### 포트 재사용과 종료

기본은 API 3000, 프론트 5179입니다. `DEV_BACKEND_PORT`와 `DEV_FRONTEND_PORT`로 변경할 수 있습니다. `DEV_BACKEND_PORT`가 없으면 백엔드의 `PORT`도 반영합니다. 두 포트가 같거나 DB 포트와 같으면 실행하지 않습니다.

```sh
DEV_BACKEND_PORT=3001 DEV_FRONTEND_PORT=5180 sh dev.sh
```

이전 실행기 상태는 `.local-dev/<API포트>-<프론트포트>.json`에 저장하며 Git에서 제외합니다. PID만 믿지 않고 실행 명령과 작업 디렉터리가 맞는지 확인한 뒤 기존 실행기에 종료를 요청합니다. 포트 정리는 지정 포트의 LISTEN 프로세스에 한정해 종료 요청 후 필요한 경우 원래 PID에만 강제 종료를 적용합니다. 전체 Node 프로세스를 종료하는 `pkill node`는 사용하지 않습니다.

**다른 프로젝트가 같은 포트를 사용 중이어도 종료될 수 있습니다.** 포트를 먼저 구분하세요. 직접 띄운 Nest/Vite watch가 서버를 다시 살려 포트를 재점유하는 경우에는 안전하게 실패하고 원래 터미널에서 종료하도록 안내합니다. 권한이 없는 프로세스, 재사용된 PID, 동시에 시작한 다른 실행기까지 임의로 강제 정리하지 않습니다. 포트 종료·재기동 수명주기는 실제 개발 PC에서 별도 확인해야 합니다.

## 2. 환경설정

기존 환경 파일을 덮어쓰지 말고 필요한 값만 수정합니다. 실행기는 dotenv 내용을 셸 명령으로 실행하지 않고 파싱합니다. `backend/.env`는 필수이고 통합 실행의 `frontend/.env`는 선택 사항입니다. 서버별로 따로 실행할 때는 프론트 API 주소와 백엔드 CORS를 직접 맞춰야 합니다.

| 설정 | 위치·용도 |
| --- | --- |
| `DATABASE_URL` | 백엔드. PostgreSQL 개발 DB 주소. 원격 개발 DB는 명시적 허용 필요 |
| `DEV_ALLOW_REMOTE_DB` | 기본 `false`. `true`이면 원격 개발 DB 허용. `--allow-remote-db`와 같은 용도 |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 백엔드 인증용 값. 서로 다른 충분히 긴 임의값 사용 |
| `PORT` / `DEV_BACKEND_PORT` | 통합 실행 API 포트. 기본 3000 |
| `DEV_FRONTEND_PORT` | 통합 실행 프론트 포트. 기본 5179 |
| `API_PREFIX` | API 경로. 기본 `/api/v1` |
| `PUBLIC_API_BASE_URL` | 통합 실행에서 로컬 API origin + prefix로 지정 |
| `PUBLIC_WS_URL` | 통합 실행에서 로컬 API origin + `/ws`로 지정 |
| `APP_PUBLIC_URL`, `API_EXTERNAL_URL`, `CORS_ORIGINS` | 통합 실행에서 두 포트에 맞춰 지정 |
| `NVIDIA_API_KEY` 등 | AI를 사용할 때만 서버에 설정. 프론트 전달 금지 |

통합 실행은 두 서버를 `127.0.0.1`에 바인딩하며 주소·CORS·HTTP 개발용 쿠키 설정을 맞춥니다. `MAIL_TRANSPORT=json`, `RATE_LIMIT_TRUST_PROXY=false`, 로컬 asset 디렉터리를 사용합니다. 프론트 자식 프로세스에는 필요한 OS 변수와 프론트의 `PUBLIC_` 설정만 전달하며 백엔드 환경 전체를 넘기지 않습니다. **`PUBLIC_` 변수는 공개 정보이므로 어떤 비밀값도 넣지 마세요.**

로컬 실행은 백엔드·프론트를 이 PC에서 실행한다는 의미입니다. 개발 DB는 다른 서버에 있어도 됩니다. 기본값에서는 원격 DB 연결 전에 중단하지만 `sh dev.sh --allow-remote-db` 또는 `backend/.env`의 `DEV_ALLOW_REMOTE_DB=true`로 개발용 원격 연결을 명시적으로 허용합니다. 옵션은 `check`·`preview`에도 적용됩니다. 터미널 환경변수는 `backend/.env`보다 우선하며 프론트 환경파일에서 이 권한을 설정할 수는 없습니다.

허용하더라도 운영·staging 환경 표시는 계속 거부합니다. DB URL의 `host`/`service` 재지정 옵션 차단, PostgreSQL 형식 검사, 프론트 비밀값 분리도 유지합니다. 잘못된 URL과 원격 DB 허용 누락을 다른 오류로 안내하며, 오류 메시지에 DB URL·계정·비밀번호를 출력하지 않습니다.

**원격 연결 허용은 읽기 전용 모드가 아닙니다.** `check`는 조회만 하지만 앱을 실행한 후에는 저장·수정이 설정된 DB에 반영됩니다. 원격 DB의 migration은 이 실행기에서 차단하며, 대상 DB를 확인한 별도 절차를 사용합니다. 주소만으로 개발/운영 용도를 판별할 수 없고 localhost의 포트 포워딩도 감지하지 못하므로, 운영 DB나 운영 DB 터널에는 절대로 사용하지 마세요.

환경 파일을 읽을 권한이 없으면 실행을 중단합니다. 파일을 복사하거나 보호 설정을 해제해 검사 도구의 비밀파일 제한을 우회하지 않습니다.

## 3. DB 준비와 migration

사용할 PostgreSQL 개발 DB가 먼저 준비되어 있어야 합니다. 이미 외부 개발 DB가 있다면 새 로컬 DB를 만들 필요 없이 원격 연결을 명시적으로 허용합니다. 아래 생성 예시는 같은 PC에 DB를 새로 준비하는 경우입니다. 실행기는 DB 서버를 설치·시작하거나 데이터베이스 자체를 생성하지 않습니다.

```sh
# PostgreSQL 연결 도구가 준비된 경우의 예시
createdb musical

# 환경설정 후, 기존 migration만 개발 DB에 적용하고 서버 시작
sh dev.sh dev --migrate
```

매일 실행할 때는 `sh dev.sh`를 사용합니다. 원격 개발 DB를 사용하는 경우 `--allow-remote-db`를 붙이거나 `backend/.env`에 `DEV_ALLOW_REMOTE_DB=true`를 설정해 둡니다. 적용하지 않은 migration이 남아 있으면 상태 검사에서 중단됩니다. 새 로컬 개발 DB 또는 새 migration이 있는 경우에만 `--migrate`를 명시합니다. 원격 DB에는 이 실행기로 migration을 적용하지 말고 대상 DB를 확인한 별도 절차를 사용합니다. 기존 DB의 migration 실패·이력 충돌은 reset으로 덮지 말고 오류와 migration 이력을 확인하세요.

| 작업 | DB 연결/변경 |
| --- | --- |
| Prisma validate / generate | 모델 문법·Client 생성. migration 적용 아님 |
| `sh dev.sh check` | 설정된 개발 DB 연결 + migration 상태 조회. 데이터 변경 없음. 원격 DB는 `--allow-remote-db` 추가 |
| `sh dev.sh dev --migrate` | 로컬 DB에 기존 migration 적용. 데이터/스키마 변경 가능 |
| `npm --prefix backend run prisma:seed` | 테스트 계정·샘플 데이터 생성/갱신. 별도 명시 실행 |
| `npm run backend:prisma:deploy` | 현재 환경의 DB에 migration 적용. 로컬 보호장치 없는 개별 명령이므로 대상 확인 필수 |

`20260907180000_track_cue_start_time`은 `track_cues.start_ms` nullable 열과 시간 범위 제약을 추가하는 기존 migration입니다. 코드 변경, 테스트 통과, Prisma Client 생성은 이 migration의 DB 적용을 의미하지 않습니다. 이번 정리에서는 새 DB migration을 추가하거나 기존 DB를 변경하지 않았습니다.

### 선택: 로컬 데모 계정

처음 구성한 개발 DB에만 seed를 사용합니다. 운영 DB에서는 실행하지 않습니다. 서버 종료 후 개발 DB 대상임을 확인하고 실행합니다.

```sh
npm --prefix backend run prisma:seed
sh dev.sh
```

기존 seed의 기본 계정은 관리자 `admin@example.com`, 배우 `actor@example.com`, 스태프 `staff@example.com`이며 기본 비밀번호는 `change-me-strong`입니다. 이 공개된 데모 비밀번호는 운영에 사용하지 않습니다. `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ACTOR_EMAIL`, `SEED_STAFF_EMAIL`, `SEED_DEMO_PASSWORD`로 개발용 값을 바꿀 수 있습니다. 관리자는 `/admin`, 배우·스태프는 `/app`에서 시작합니다.

## 4. 대본·타임라인 규칙

공연 시간은 달력 날짜가 아니라 **공연 시작 후 경과시간**입니다. `MM:SS`, `HH:MM:SS`, 밀리초와 구간 표시를 지원합니다.

```text
[00:00 --> 00:05] 해설자: 오늘의 이야기를 시작합니다.
[00:05.000 --> 00:09.500] 배우: 안녕하세요.
[00:09.500] 조명 암전
```

원문의 시간표시와 행 번호를 먼저 파싱합니다. AI 결과는 원문과 연결해 시간을 복원하며, 원문 누락·중복·분석 실패 결과를 그대로 적용하지 않습니다. 기존 수동 수정 대본을 AI가 자동으로 교체하지 않으며 새 대본 또는 명시적인 이어붙이기로 적용합니다.

시간이 없는 항목은 `null`로 저장하고 추정 배치로 구분합니다. 기본 대사 8초, 큐 30초는 확정 시간이 아닙니다. 시작 시점과 길이를 직접 수정할 수 있으며, 큐 길이는 정수 초, 대사 길이는 밀리초 단위입니다. 시간 계산은 도형 너비나 화면 배율에 의존하지 않습니다.

`/app/p/[pid]/live`는 개인 재생·일시정지·시점 이동·배속·장면 반복·배역 강조와 숫자 시간 편집을 제공합니다. 기존 큐시트 스튜디오는 PC 중심 편집 화면이고 도형 배치가 정밀한 실제 시간 재생을 대신하지 않습니다. 여러 대본은 연습 화면에서 하나를 선택합니다.

큐에 연결된 이미지·영상·음원을 사용하며 소리는 기본 꺼짐입니다. 코덱·자동재생 권한·signed URL·네트워크 조건은 실제 브라우저에서 검증해야 합니다. 전체화면은 로그인 기기의 배경과 대사/가사 출력이며 스태프 메모는 제외합니다. 관객용 공개 링크, 음성 인식 자동 추종, 여러 기기 동시 공연 제어와는 다릅니다. 관객 자막 활용 전 내용·접근성·출력 환경 검수가 필요합니다. 개인 연습은 공유 reading-session 상태를 수정하지 않습니다.

공개 메인의 `ProductPreview.svelte`는 이런 흐름을 설명하는 독립 예시입니다. 재생·일시정지·시점 이동과 일정/참여자 화면 전환은 가능하지만 실제 공연을 불러오거나 저장하지 않습니다.

## 5. 일정·권한·개인정보 규칙

일정 충돌은 시작 포함·종료 제외 범위로 계산합니다. 예를 들어 10:00–11:00과 11:00–12:00은 겹치지 않습니다. 자정을 넘는 일정과 다일 일정은 해당 날짜들에 표시하되, 자정에 끝나는 일정이 다음 날에 중복 표시되지 않도록 합니다. 종료 시각이 시작 시각보다 늦어야 하며 조회 구간도 뒤집힌 값을 거부합니다.

한 회원이 여러 공연에 참여하면 공연별 membership ID가 서로 다릅니다. 충돌 검사는 user ID를 기준으로 개인 일정 및 다른 공연 참석 일정까지 확인합니다. 불참 응답은 충돌에서 제외하고, 수정 중인 자기 일정은 다시 충돌로 세지 않습니다. 소프트 삭제된 공연은 이번 공연 참석 충돌 조회에서 제외합니다.

개인 일정 제목·메모는 배정자에게 노출하지 않습니다. 다른 공연과 충돌할 때는 시간 범위와 일반적인 충돌 사유만 반환하고 그 공연의 비공개 제목·일정 ID는 숨깁니다. 같은 공연 내 충돌은 해당 일정 정보를 유지합니다.

배우·스태프의 일정 등록 권한과 제작진의 수정·취소·충돌 강행 권한은 구분합니다. 강행 배정에는 사유를 남깁니다. 음악감독은 음악연습 일정 편집 범위이며 기존 일정의 유형을 변경하는 방식으로 권한을 우회할 수 없습니다. 수정 전 유형과 변경 후 유형을 모두 확인합니다. 중복 관계 ID와 공백뿐인 일정 제목은 DTO 단계에서 거부합니다.

리마인더 중복 확인 키는 참석 ID + 현재 시작 시각입니다. 시간을 변경하면 새 시각 기준 리마인더 대상이 될 수 있습니다. 메일과 리마인더 worker의 동시 실행·실제 전달·여러 요청의 동시 일정 등록 경쟁 조건은 이번 오프라인 회귀검사가 보장하는 범위가 아니므로 운영 통합 검증이 필요합니다.

공연·대본·큐는 소프트 삭제/복구 정책을 사용합니다. 일정 취소는 별도 취소 사유·연결 영향 확인·감사 로그 절차이므로 모든 테이블이 소프트 삭제된다고 가정하지 않습니다. 조직관리자 권한은 조직 단위로 유지하고 전역 슈퍼관리자와 합치지 않습니다.

## 6. AI와 별도 worker

이 저장소의 NVIDIA 기본 설정은 아래와 같습니다. 공급자의 현재 모델 제공 여부를 검증한 목록이 아니라 프로젝트 설정값입니다. 공급자 키는 서버 Secret/Env에만 등록합니다.

```dotenv
NVIDIA_API_KEY=<서버 전용 키>
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

모델별 지원 옵션을 확인하고 불필요한 추가 옵션은 `{}`로 비웁니다. JavaScript SDK에서는 추가 객체를 요청 최상위에 펼치므로 Python의 `extra_body` 래퍼를 그대로 중첩하지 않습니다. 다른 공급자를 사용할 때는 `NVIDIA_API_KEY`를 제거하고 `LLM_API_KEY` 및 맞는 `LLM_BASE_URL`을 설정합니다. 키가 다른 공급자로 전달되는 조합은 거부합니다.

AI 분석은 NDJSON 진행 응답이고 연결이 끊기면 공급자 요청을 취소합니다. 영속 작업 큐·재접속 복구는 현재 제공하지 않습니다. 실키 호출·요금·완료 시간은 오프라인 검사 대상이 아닙니다.

메일은 API 요청 중 직접 발송하지 않고 outbox에 저장합니다. 아래 worker는 자동 시작하지 않습니다. 개별 실행 시 통합 실행기의 환경 덮어쓰기를 상속하지 않으므로, **먼저 개발 DB와 메일 설정을 확인하세요.**

```sh
# 로컬 테스트: 실제 메일 발송을 방지하는 transport를 명시
MAIL_TRANSPORT=json npm --prefix backend run mail:worker
MAIL_TRANSPORT=json npm --prefix backend run attendance:reminders
```

운영에서는 검증한 SMTP/Resend 설정과 worker 실행 정책을 별도로 적용합니다.

## 7. 자동 검사와 실제 사용 검사

| 명령 | 확인 범위 |
| --- | --- |
| `npm run test` | Client 생성·백엔드 빌드, Jest, AI/타임라인/달력/조직 권한, 로컬 실행기 순수 로직·문법 |
| `npm run check` | Prisma validate/generate, 백엔드 빌드, SvelteKit sync, 전체 Svelte 타입 검사 |
| `npm run build` | 백엔드·프론트 배포 빌드 |
| `npm run dev:check` | 실제 로컬 환경파일·의존성 경로·DB 연결·migration 상태 |

품질 검사의 Prisma URL은 validate/generate용 비운영 자리표시자입니다. migration/seed로 전달하지 않습니다. `qa:*`는 기존 로컬 스모크 도구이며 일부 파일은 저장소에서 제외되어 있으므로, 새 체크아웃의 공통 검사 진입점으로는 `test/check/build`를 사용합니다. 없는 스모크 파일이나 실행하지 않은 검사를 통과로 기록하지 않습니다.

### 2026-09-08 확인된 결과

| 검사 | 결과 |
| --- | --- |
| Prisma schema validate / Client generate | 통과. 실제 DB 상태 검사는 아님 |
| NestJS build | 통과 |
| Jest | 4 suites, 16 tests 통과 |
| 로컬 실행기 Node 테스트 | 9 tests 통과. 외부 DB 차단, 포트 일치, 환경 분리, 명령/PID/문법 등 |
| 타임라인·AI·달력·조직 권한 회귀검사 | 통과 |
| Svelte client/server 문법 컴파일 | 5개 화면/컴포넌트, 경고 0개 |
| 전체 `check` | 종료 코드 1. SvelteKit sync가 `frontend/.env` 읽기 `EPERM`으로 중단 |
| 전체 `build` | 종료 코드 1. Vite가 동일 환경파일 읽기 `EPERM`으로 중단 |
| 실제 DB 연결·migration 적용 상태 | 이 검사 환경에서는 미확인 |
| 서버 2개 기동·포트 재사용·브라우저/모바일 실사용 | 미실행 |

Svelte 문법 컴파일은 전체 타입 검사·번들·SSR/브라우저 통합 검사를 대체하지 않습니다. 비밀파일 보호를 우회하지 않았으며, 실제 DB를 변경하거나 seed·배포·Git 커밋/푸시를 실행하지 않았습니다.

### 실제 개발 PC에서 확인할 흐름

| 영역 | 확인할 시나리오 |
| --- | --- |
| 시작/종료 | `sh dev.sh check` 성공 → `sh dev.sh` → 두 주소 응답 → 재실행 시 기존 실행기 정리 → Ctrl+C 후 두 포트 종료 |
| 공개 메인 | 모바일/PC 줄바꿈·가로 넘침, 예시 재생/정지/시점 이동, 화면 탭, FAQ 키보드 탐색, 문의 성공/오류/중복 클릭 |
| 회원·권한 | 관리자/배우/스태프 로그인, 다른 공연·다른 조직 접근 거부, 배정 변경 반영 |
| 일정 | 개인 일정과 충돌, 동일 회원의 다른 공연 충돌, 경계가 맞닿은 일정, 자정·월 경계·다일 일정, 참석/불참 변경, 강행 사유 |
| 시간표 | 원문 시간 보존, 시간 없는 항목 추정 표시, 2초 큐 유지, 시작/길이 저장 후 새로고침, 선택 대본·장면 반복 |
| 실제 출력 | iOS/Android/PC 미디어 형식·권한·signed URL, 소리 켜기, 전체화면 자막/배경과 스태프 메모 미노출 |

## 8. 문제 해결과 운영 경계

| 증상 | 확인 |
| --- | --- |
| `EPERM` / `SECRET_PATH_DENIED` | 도구 환경의 파일 접근 제한 여부. 보호 해제·다른 경로 복사로 우회하지 않음. 권한 있는 개발 터미널에서 검증 |
| 로컬 DB만 허용한다는 오류 / 원격 DB 허용 누락 | 접속 이전 실행기 검사입니다. 외부 개발 DB가 맞으면 `sh dev.sh --allow-remote-db` 또는 `backend/.env`의 `DEV_ALLOW_REMOTE_DB=true` 사용. DB 주소를 임의로 localhost로 변경하지 않음 |
| DB 연결 실패 | PostgreSQL 실행, 개발 DB 존재, 계정·비밀번호·포트, 네트워크·방화벽·접속 허용, URL 확인. 비밀번호가 포함된 오류/URL 공유 금지 |
| migration status 실패 | 기존 migration 적용/실패 이력 확인. 로컬 DB이면 `--migrate` 명시, 원격 DB는 대상 확인 후 별도 적용. 자동 reset 금지 |
| 로그인 후 갱신 실패 | 프론트와 API 호스트를 `127.0.0.1`로 통일, CORS·쿠키 확인. 운영 secure 설정을 운영 코드에서 해제하지 않음 |
| 포트가 다시 점유됨 | 다른 터미널의 수동 watch/프로세스 관리자가 재시작하는지 확인하고 원래 실행 주체 종료 |
| 메일이 안 옴 | 통합 실행은 의도적으로 실제 발송 안 함. outbox/worker와 개발용 transport 구분 |
| AI 분석만 실패 | 서버 공급자 키·base URL·모델 옵션 확인. 일반 기능 테스트와 분리 |

운영에서는 `backend/.env.production.example`과 `frontend/.env.production.example`을 참고해 배포 플랫폼 Secret/Env를 구성합니다. 운영용 비밀값, HTTPS/CORS, secure cookie, 저장소 경로 검증을 유지합니다. `dev.sh preview`는 운영 서버가 아니라 개발 DB를 사용하는 로컬 미리보기입니다.

운영 DB를 백업하고 복구 가능성을 확인한 뒤 별도 release 단계에서 migration을 적용합니다. migration 대상 환경을 확인한 다음 백엔드/프론트를 배포하고 readiness·권한·로그인·일정·미디어·worker를 점검합니다. 기존 `docs/runbook/release.md`, `PRD.md`가 있는 로컬에서는 함께 참고할 수 있으나 저장소 공통 안내는 이 문서를 기준으로 합니다.
