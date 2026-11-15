# 개발·DB·검증 가이드

이 문서는 루트 [README.md](README.md)의 상세 안내입니다. 정식 오픈 준비와 운영 적용 순서는 [LAUNCH_READINESS.md](LAUNCH_READINESS.md)를 따릅니다. 기본 개발 흐름은 `sh dev.sh`이며 운영 배포와 구분합니다. 현재 구현은 NestJS/Prisma 백엔드와 SvelteKit 프론트입니다. 기존 Python 예시와 달리 이 저장소의 AI 호출은 OpenAI JavaScript SDK를 사용합니다.

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
| `ASSET_STORAGE`, `R2_*` | R2 파일 저장 설정. 아래 저장 경로와 [운영 가이드](SITE_OPERATIONS.md#r2-파일-저장과-키-교체) 참고 |

통합 실행은 두 서버를 `127.0.0.1`에 바인딩하며 주소·CORS·HTTP 개발용 쿠키 설정을 맞춥니다. `MAIL_TRANSPORT=json`, `RATE_LIMIT_TRUST_PROXY=false`를 사용하고 로컬 파일 디렉터리를 지정합니다. R2 설정이 완전하면 파일은 R2에 저장하므로 개발 화면의 업로드도 실제 버킷에 반영됩니다. 프론트 자식 프로세스에는 필요한 OS 변수와 프론트의 `PUBLIC_` 설정만 전달하며 백엔드 환경 전체를 넘기지 않습니다. **`PUBLIC_` 변수는 공개 정보이므로 어떤 비밀값도 넣지 마세요.**

현재 개발 파일 저장 경로는 `attachment` 버킷의 `art-bridge/`다. `backend/.env`의 `R2_PROJECT_NAME=art-bridge`, `R2_LEGACY_PROJECT_NAMES=reading-musical`, 빈 `R2_KEY_PREFIX`를 사용한다. 새 파일만 새 경로에 저장하고 기존 `reading-musical/` 객체와 DB의 storageKey는 유지한다. 이전 프로젝트 목록은 같은 버킷·고정 prefix에서만 적용되며 경로·wildcard는 허용하지 않는다. root `.env`의 Cloudflare 관리 키는 앱에 전달하지 않는다.

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

migration은 `backend/prisma/migrations/` 전체 목록과 대상 DB 이력을 대조합니다. 최근 공연 소개(`20261023090000_performance_showcase`)와 모집(`20261023120000_recruitment`)도 포함합니다. 코드·테스트·Client 생성은 대상 DB에 migration이 적용됐다는 뜻이 아닙니다. 개발 DB 적용 결과와 운영 DB 상태를 구분하며 이번 문서 정리에서는 DB를 변경하지 않았습니다.

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

K-EXAONE 2.5는 `backend/.env`의 공통 `LLM_API_KEY`에 EXAONE에서 발급받은 키를 넣어 사용합니다. `NVIDIA_API_KEY`는 환경과 파일에서 비우거나 주석 처리하세요.

```dotenv
LLM_API_KEY=""
LLM_BASE_URL=https://api.exaone.ai/v1
LLM_MODEL=k-exaone_v2.5
LLM_JSON_MODE=false
LLM_EXTRA_BODY_JSON={"reasoning_effort":"low"}
```

저장 후 기존 실행 명령으로 서버를 재시작합니다. 이 설정은 대본 초안과 영상 매칭에 함께 적용됩니다. `api.exaone.ai`에 보내는 요청에서는 `LLM_SEED`를 생략합니다. 연결은 관리자 시스템 점검에서 확인하고, 가상 대본의 초안과 원문 시간표시는 대본 등록 화면에서 검토합니다.

EXAONE 호출은 API 프로세스에서 한 번에 하나씩 처리하고, 새 호출은 최소 1초 간격으로 시작합니다. 분석이 진행 중이면 연결 점검은 새 요청을 보내지 않습니다. 공급자가 `429`를 반환하면 `Retry-After`와 설정된 재시도 횟수를 따릅니다. 전송 오류나 타임아웃이 난 호출은 공급자에서 아직 진행 중일 수 있어 자동 재전송하지 않습니다.

AI 분석은 NDJSON 진행 응답이고 연결이 끊기면 공급자 요청을 취소합니다. 영속 작업 큐·재접속 복구는 현재 제공하지 않습니다. 실키 호출·요금·완료 시간은 오프라인 검사 대상이 아닙니다.

### 대본·큐시트와 공연 도우미

대본 분석은 `backend/src/ai/harness/skills/script-analysis/SKILL.md`를 읽어 기존 초안을 생성합니다. Word 큐시트는 서버에서 표로 읽고, 표와 대본이 명확히 일치하지 않는 항목에는 `cue-sheet-match` 스킬을 적용합니다. 운영 관리자 메뉴의 공연 도우미는 `production-operations` 스킬로 공연 준비 현황, 새 공연 초안, 기존 일정 변경을 다룹니다.

큐시트 추가 대조와 공연 도우미는 기존 `LLM_API_KEY`, `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_MODEL=gpt-6.1-terra`로 Responses API를 호출합니다. 공통 실행기는 `backend/src/ai/harness/responses-harness.ts`에 있습니다. 도구를 추가할 때 업무별 서비스에 입출력 범위와 설명을 등록하고, 기존 권한 검사를 거친 데이터만 반환합니다. 모델 호출은 요청마다 최대 네 번, 그중 도구 실행은 최대 세 번입니다. 대본·큐와 공연 등록은 검토 화면에서 사용자가 실행하는 기존 저장 경로를 사용합니다.

서버의 `ResponsesHarness` 로그에는 실행 ID, 모델, 스킬 원본과 전달 지침의 해시, 도구 이름·결과·소요 시간, 종료 사유를 기록합니다. 스킬 해시는 사용한 버전을 확인하는 값입니다. 분석 정확도는 합성 원문과 결과를 대조해 확인합니다.

공연 도우미에서 “달빛 우체국 최종 연습을 저녁 7시로 바꿔 줘”라고 입력하면 `find_schedule_events`가 기존 일정을 찾아 `preview_schedule_change`에 넘길 후보를 반환합니다. 후보가 여러 개면 화면에서 일정을 고릅니다. 시작 시간만 바꾸면 기존 소요 시간을 유지합니다. 서버가 한국 시간 기준 변경 전후, 참석 충돌, 기존에 참석·미정으로 답해 다시 응답할 사람을 표시합니다. 같은 일정에는 “그럼 저녁 7시 반으로”라고 이어서 요청할 수 있습니다.

운영 관리자가 **이 시간으로 변경하고 알리기**를 누르면 본인에게 발급된 10분 유효 확인 토큰을 검증하고 기존 `ScheduleService.updateEvent`로 저장합니다. 확인 시점에 일정이나 응답이 바뀌었거나 충돌이 생겼으면 새 미리보기를 보여 줍니다. 일정, 재응답 상태, 변경 이력(`schedule.assistant_time_changed`)은 같은 트랜잭션에 기록합니다. 운영 메뉴 **활동 기록**에서 ‘공연 도우미에서 일정을 변경했어요’를 찾을 수 있습니다. 기존 알림·메일 큐를 통해 참석자에게 시간 변경을 알리고, 재응답 안내는 초기화된 사람에게 표시합니다.

현재 운영 기능에는 OpenAI JavaScript SDK의 Responses API와 앱의 도구 실행기를 사용합니다. 모델은 요청을 해석하고 읽기 도구를 선택하며, NestJS가 권한·확인·충돌 검사와 변경 이력을 처리합니다. 도구 결과에서 참석자 정보와 확인 토큰은 서버가 화면으로 직접 보냅니다. 여러 단계의 세션, 다른 에이전트 인계가 실제 운영 요구로 생기면 Agents SDK의 runner와 sessions를 비교합니다. Codex SDK는 개발·테스트 자동화에 활용할 수 있습니다. [Agents 실행 방식](https://developers.openai.com/api/docs/guides/agents#compare-agent-runtime-options), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)

메일은 API 요청 중 직접 발송하지 않고 outbox에 저장합니다. 아래 worker는 자동 시작하지 않습니다. 개별 실행 시 통합 실행기의 환경 덮어쓰기를 상속하지 않으므로, **먼저 개발 DB와 메일 설정을 확인하세요.**

```sh
# 로컬 테스트: 실제 메일 발송을 방지하는 transport를 명시
MAIL_TRANSPORT=json npm --prefix backend run mail:worker
MAIL_TRANSPORT=json npm --prefix backend run attendance:reminders
```

운영에서는 메일 설정과 worker 실행 정책을 별도로 적용합니다. 현재 release preflight는 Resend를 요구합니다. `MAIL_SENDING_ENABLED` 기본값은 true이므로 실제 발송 보류·과거 큐 점검·승인된 수신자 검증 순서는 [SITE_OPERATIONS.md](SITE_OPERATIONS.md)를 따릅니다.

신규 가입 이메일 인증은 `auth/registration/email/request`→`verify`에서 받은 일회성 `emailVerificationToken`을 최종 `auth/register`에 제출합니다. 실제 경로에는 공통 `/api/v1` prefix가 붙습니다. 기존 로그인·초대 수락·비밀번호 복구 API는 유지합니다. `20261023180000_registration_email` migration은 별도 challenge 테이블만 추가하며, 적용 여부는 HANDOFF 1절을 확인합니다. 인증번호/proof·비밀번호를 terminal·URL·fixture 출력에 남기지 않습니다.

`npm --prefix backend run registration:purge`는 build 후 오래된 가입 인증 기록/메일 본문을 실제 정리하는 명령이며, `registration:purge:prod`는 기존 build를 사용합니다. 검사 명령이 아니므로 대상·보관 기준을 확인한 뒤 승인된 환경에서만 실행합니다. 메일 보류와 독립적이며 예약 작업은 자동 설치하지 않습니다.

### 공연 일괄 등록 도구와 재시도 파일

`scripts/setup-production.mjs`는 로컬 개발 서버에 관리자 로그인한 뒤 대본 추출·AI 초안 생성(`draft`) → 대본·역할·큐와 장·막 적용(`apply`) → 미디어 업로드·구간 연결(`media`) 순서로 실행하는 개발 도구다. 배포 설치기나 읽기 전용 검사가 아니다. 담당자가 대상 개발 DB·계정·공연과 AI 호출·파일 저장 범위를 먼저 확인한 뒤 실행한다. 완료한 단계와 업로드는 상태 파일을 기준으로 건너뛴다.

`.local-dev/setup-production.json`은 Git에서 제외되지만 공연 ID뿐 아니라 AI가 추출한 대사·배우 이름·큐·파일명을 포함할 수 있는 개인·공연 자료다. 실행 담당자가 보관과 정리를 책임진다. 권한은 `0600`으로 저장하고 기존 파일도 같은 권한으로 제한한다. 재시도에 필요한 동안만 유지하고, 적용 결과와 미디어 연결 확인을 마쳤거나 작업 폐기를 결정한 뒤 담당자가 정리한다. 다른 공연을 구성하기 전에는 상태 파일의 공연 범위를 확인하고 이전 공연의 재시도 상태를 재사용하지 않는다. 도구와 이번 품질 검사는 실제 상태 파일을 자동 삭제하지 않는다.

터미널에는 고정된 오류 code·단계·유효한 HTTP status와 집계 숫자만 출력한다. 대사·막/장면 제목·파일명·토큰·HTTP/AI 응답 원문은 출력하지 않는다. 전체 품질 검사에 포함된 `setup-production-contract.mjs`는 임시 디렉터리의 합성 설정·대본·미디어와 mock fetch만 사용하며 실제 환경 파일·기존 계정·AI·DB·R2에 접근하지 않는다.

## 7. 자동 검사와 실제 사용 검사

| 명령 | 확인 범위 |
| --- | --- |
| `npm run test` | Client 생성·백엔드 빌드, Jest, AI/타임라인/달력/조직 권한, 로컬 실행기 순수 로직·문법 |
| `npm run check` | Prisma validate/generate, 백엔드 빌드, SvelteKit sync, 전체 Svelte 타입 검사 |
| `npm run build` | 백엔드·프론트 배포 빌드 |
| `npm run dev:check` | 실제 로컬 환경파일·의존성 경로·DB 연결·migration 상태 |

품질 검사의 Prisma URL은 validate/generate용 비운영 자리표시자입니다. migration/seed로 전달하지 않습니다. `qa:*`는 기존 로컬 스모크 도구이며 일부 파일은 저장소에서 제외되어 있으므로, 새 체크아웃의 공통 검사 진입점으로는 `test/check/build`를 사용합니다. 없는 스모크 파일이나 실행하지 않은 검사를 통과로 기록하지 않습니다.

### 현재 검증 기준

최신13차 로컬 검증(2026-10-24)은 check PASS(Svelte 오류·경고0)·test PASS(87 suites/905 tests와 Node 회귀223건)·build PASS다. 실제 관리자 등록·이미지 저장·목록·수정13항목과 QA 데이터 정리가 통과했다. 초기 브라우저 종료 promise 시간 초과는 기능 결과와 구분해 기록했다. 10차 이메일 인증에서는 승인 후 개발 DB 신규 테이블을 적용하고 PostgreSQL50건·합성 API 브라우저16건을 검증했다. 품질 검사는 설치 deps를 재사용한 별도 snapshot이며 fresh npm ci·GitHub CI·외부 메일·운영 결과는 아니다. 최종 결과·제약은 [HANDOFF.md](HANDOFF.md) 1절에서 확인한다.

CI는 임시 PostgreSQL의 migration 검증 뒤 같은 `check/test/build`를 실행한다. GitHub에서 현재 후보 SHA가 실제 통과했는지는 별도 확인한다. `.gitignore` 예외에 포함된 회귀 파일과 새 source/migration도 후보 커밋에 모두 포함돼야 한다.

배포 가능한 빌드는 운영 DB·복원·파일·메일·실물 기기 검증과 다르다. GitHub CI 성공, 로컬/개발 DB 결과, 운영 승인과 배포 결과를 따로 기록한다. 전체 검사는 Nest watch와 같은 dist에 쓰지 않도록 정상 종료 후 실행하거나 별도 작업 디렉터리에서 수행한다.

### 실제 개발 PC에서 확인할 흐름

| 영역 | 확인할 시나리오 |
| --- | --- |
| 시작/종료 | `sh dev.sh check` 성공 → `sh dev.sh` → 두 주소 응답 → 재실행 시 기존 실행기 정리 → Ctrl+C 후 두 포트 종료 |
| 공개 메인 | 모바일/PC 줄바꿈·가로 넘침, 게시된 공연만 노출·관객 상세/이미지, FAQ 키보드 탐색, 문의 성공/오류/중복 클릭 |
| 회원·권한 | 관리자/배우/스태프 로그인, 다른 공연·다른 조직 접근 거부, 배정 변경 반영, 두 탭 계정 전환·지연 업로드 차단 |
| 모집·공개 동의 | 타 조직 지원→승인→팀 연결, 철회·미선정·동시 정원, 사진 신규 수집/교체·이름/사진 공개·철회 |
| 일정 | 개인 일정과 충돌, 동일 회원의 다른 공연 충돌, 경계가 맞닿은 일정, 자정·월 경계·다일 일정, 참석/불참 변경, 강행 사유 |
| 시간표 | 원문 시간 보존, 시간 없는 항목 추정 표시, 2초 큐 유지, 시작/길이 저장 후 새로고침, 선택 대본·장면 반복 |
| 실제 출력 | iOS/Android/PC 미디어 형식·권한·signed URL, 소리 켜기, 전체화면 자막/배경과 스태프 메모 미노출 |

### UI 컴포넌트 Storybook

`frontend/src/lib/components/ui` 컴포넌트의 변형·크기·다크·모바일 폭과 접근성은 Storybook으로 확인합니다.

- 실행: `npm --prefix frontend run storybook` (http://127.0.0.1:6006). 상단 툴바에서 테마(다크/라이트)와 뷰포트(모바일 등)를 바꾸고, 접근성 탭에서 점검합니다.
- 정적 빌드 확인: `npm --prefix frontend run build-storybook` (결과 `frontend/storybook-static/`은 git에서 제외).
- 새 UI 컴포넌트를 `ui/` 아래에 추가하면 같은 폴더에 `<이름>.stories.svelte`도 함께 추가합니다. 스토리는 `apiRequest`·소켓·라우트 store에 의존하지 않고, 문구는 `~해요`체로 씁니다.
- Storybook은 개발 도구라 `npm run build`와 배포 이미지에는 포함되지 않습니다.

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

운영 DB를 백업하고 복구 가능성을 확인한 뒤 승인된 release 단계에서 migration을 적용합니다. Docker API는 migration을 자동 실행하지 않고, 현재 Railpack API startCommand는 실행하므로 배포 방식을 먼저 확정합니다. migration 대상 환경을 확인한 다음 백엔드/프론트를 배포하고 readiness·권한·로그인·일정·미디어·worker를 점검합니다. 기존 `docs/runbook/release.md`, `PRD.md`가 있는 로컬에서는 함께 참고할 수 있으나 저장소 공통 안내는 이 문서를 기준으로 합니다.
