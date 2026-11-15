# 아트브릿지 · Reading Musical

공연팀의 대본·자료·배역·일정·큐시트·개인 연습을 함께 관리하는 플랫폼이다. 배우·스태프는 로그인하면 내 일정과 참여 중인 공연부터 확인한다. 공연팀은 회원 공개 모집으로 지원자를 받고, 승인한 사람을 해당 공연팀에 연결할 수 있다.

관객에게 보여 줄 공연 소개는 내부 작업과 분리해 게시한다. 메인과 공연 소식에서 포스터·소개·사진·영상 링크를 제공하며, 출연진의 이름·사진은 본인이 공연별 공개를 선택한 경우에만 표시한다. 단체별 셀프 온보딩·결제 서비스는 현재 제공하지 않는다.

## 현재 기능과 화면

| 사용 흐름 | 화면 | 주요 기능 |
| --- | --- | --- |
| 내 공연·일정 | `/app`, `/app/schedule` | 다음 본인 일정·참석 응답, 참여 공연, 개인 일정·불가일 |
| 모집·지원 | `/app/opportunities`, `/app/opportunities/[id]`, `/app/applications` | 조직·기본 활동 직군과 관계없는 배우/스태프 지원, 검토·추가 검토·승인·미선정·철회·재지원 |
| 공연 작업 | `/app/p/[pid]` | 공연 홈, 대본·자료 구성, 대본 읽기, 배역, 큐시트, 팀 일정·게시판·체크리스트 |
| 개인 연습 | `/app/p/[pid]/live` | 재생·장면 반복·배역/트랙 강조, 개인 메모·완료·재생 위치 저장 |
| 큐시트 | `/app/p/[pid]/cuesheet` | 담당 트랙·큐·미디어, 목록/타임라인, 인쇄·CSV·MP4 내보내기 |
| 공연 관리 | `/app/p/[pid]/manage/*` | 멤버·역할·직무, 캐스팅, 기획 메모, 공연 설정·관객 소개, 모집 회차·지원 검토 |
| 운영 콘솔 | `/admin`, `/admin/productions`, `/admin/members` | 운영 현황 대시보드, 공연 등록·준비 상태, 회원·신청·문의·사이트 관리 |
| 관객용 공연 소개 | `/`, `/performances`, `/performances/[slug]` | 게시된 공연 소식·관람 안내·동의한 출연진 |
| 프로필·동의·지원 | `/app/profile`, `/app/privacy`, `/support`, `/faq` | 본인 프로필·공개/수신 동의, 운영 문의·도움말 |

지원만으로 내부 공연 자료에 접근할 수는 없다. 승인은 신청한 ACTOR/STAFF 역할만 추가하며 원래 조직·플랫폼 등급·기존 공연 역할을 유지한다. 배역·직무·일정 참석·출연진 공개 동의는 별도로 정한다.

신규 가입은 이메일로 받은 6자리 인증번호를 확인한 뒤 진행한다. 인증번호와 가입 증명은 각각 10분 동안 유효하며 계정은 최종 가입 때 생성한다. 초대받은 신규 회원도 이메일을 확인하고 기존 초대를 수락한다. 기존 회원 로그인·초대 수락·비밀번호 복구에는 신규 가입 인증을 소급 적용하지 않는다. 이 기능의 DB 적용·검증 상태는 HANDOFF 1절을 확인한다.

SUPER_ADMIN은 `/admin`, 일반 회원·단체 관리자는 `/app`에서 시작한다. 단체 관리자 권한은 해당 조직에 한정하고, 다른 조직 공연에서는 배정받은 공연 역할만 적용한다. 조회·멤버 추가·직무 변경·배역·일정 편집을 각각 구분하며 프론트 메뉴와 별개로 서버가 검증한다. 개인 기록·비공개 주석·타인 연락처·프로필의 공개 범위도 서버에서 제한한다.

개인 연습 `/live`는 여러 기기가 함께 진행하는 온라인 리딩과 다르다. 독립 진행표·무대 배치·일정 수정 전용 UI 등 후속 기능은 [BACKLOG.md](BACKLOG.md)에서 구분한다.

## 로컬 개발 시작

macOS/Linux, Node.js 22 이상, npm, `lsof`, PostgreSQL 개발 DB가 필요하다. NestJS 11·Prisma와 SvelteKit 2·Svelte 5·Tailwind 4를 사용한다. 실행기는 패키지 설치·PostgreSQL 설치·DB 생성을 대신하지 않는다.

```sh
# 저장소 루트에서 lockfile 기준 설치
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

`backend/.env.example`을 기준으로 **개발용** `backend/.env`를 준비한다. 기존 환경 파일은 덮어쓰지 않는다. 필수 값은 `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`이며 두 JWT secret은 서로 다른 값을 사용한다. 통합 실행에서는 API·WebSocket 주소와 CORS를 함께 맞추므로 `frontend/.env`는 선택 사항이다. 서버 키·DB 비밀번호를 `PUBLIC_` 변수나 저장소에 넣지 않는다.

파일은 R2를 설정하면 브라우저에서 비공개 버킷에 직접 업로드한다. 현재 개발 구성은 `attachment/art-bridge/`이며 기존 `reading-musical/` 파일도 유지한다. 경로·권한·키 교체 절차는 [저장소 운영](SITE_OPERATIONS.md#r2-파일-저장과-키-교체)을 따른다.

관리자 공연 등록과 공연 소개 편집에서 포스터·홍보 사진을 선택하거나 끌어 놓으면 먼저 브라우저에서 미리 본다. 등록·초안 저장을 눌러야 이미지가 업로드되어 글에 연결된다. 포스터1장·홍보 사진8장, 각10MB 이하의 PNG·JPEG·WebP를 지원한다. 소개 공개는 초안 저장 후 별도로 게시한다.

### 공연 등록과 참여 안내

- 운영 관리자는 **공연 관리 → 공연 등록**에서 이름을 입력하고 저장한다. 장소, 공연일, 소개, 사진은 준비된 것부터 추가한다. 등록 뒤 **대본·자료 준비** 화면에서 대본을 올리거나 **멤버·배역**, **일정**으로 이동할 수 있다.
- **멤버 관리 → 멤버 추가**에서 배우·스태프 역할을 고른 뒤 기존 회원을 배정한다. 이메일 초대는 초대받은 계정으로 수락하면 해당 공연으로 안내한다.
- 배우는 **내 공연 → 대본 읽기**, 스태프는 **내 공연 → 큐시트 보기**에서 필요한 자료를 찾는다. 일정 알림을 열면 해당 일정의 시간과 장소를 보고 참석 여부를 바로 응답할 수 있다.

개발 DB와 migration 이력이 준비된 뒤 실행한다.

```sh
sh dev.sh check   # 설정·의존성·DB 연결·migration 상태 확인, DB 변경 없음
sh dev.sh         # 백엔드 watch + 프론트 개발 서버
```

DB가 개발 전용 원격 서버에 있으면 대상을 확인한 뒤 명시적으로 허용한다. 주소를 임의로 localhost로 바꾸거나 운영 DB 터널을 사용하지 않는다.

```sh
sh dev.sh check --allow-remote-db
sh dev.sh --allow-remote-db
```

원격 허용은 읽기 전용 모드가 아니다. 앱에서 저장한 내용은 설정된 개발 DB에 반영된다. 일반 기동은 migration을 자동 적용하지 않으며, 원격 DB의 `--migrate`는 실행기에서 차단한다. 새 DB·미적용 migration은 [개발 가이드](DEVELOPMENT.md)의 대상 확인 절차를 따른다. 운영 migration·reset·seed를 개발 실행 명령과 섞지 않는다.

기동 전 선택 포트를 확인한다. 실행기는 이전 통합 실행기와 해당 포트의 프로세스를 정리하므로 다른 프로젝트가 같은 포트를 사용하면 영향을 받을 수 있다. 종료는 `Ctrl+C`를 사용한다. 로그인·쿠키 검증에서는 `127.0.0.1`과 `localhost`를 섞지 않는다.

| 용도 | 기본 주소 |
| --- | --- |
| 웹·로그인 | `http://127.0.0.1:5179` · `/login` |
| REST API | `http://127.0.0.1:3000/api/v1` |
| API 문서·OpenAPI | `http://127.0.0.1:3000/api/docs` · `/api-json` |
| DB 포함 준비 상태 | `http://127.0.0.1:3000/health/ready` |

포트·preview 등 옵션은 `sh dev.sh --help`로 확인한다. 로컬 기동은 실제 메일을 발송하지 않는 `json` transport를 사용하며 메일·리마인더 worker를 자동 시작하지 않는다. AI 공급자 키는 일반 공연·일정 사용의 필수 조건이 아니며 AI 분석을 사용할 때 서버에 별도 설정한다.

## 품질 검사

| 명령 | 범위 |
| --- | --- |
| `npm run check` | Prisma validate/generate, 백엔드 빌드, 전체 Svelte 타입 검사 |
| `npm run test` | 백엔드 단위검사, 권한·계정 격리·미디어·타임라인·화면 상태·실행기 회귀 |
| `npm run build` | 백엔드·프론트 빌드 |
| `npm run dev:check` | 현재 개발 설정·DB 연결·migration 상태 조회 |
| `node scripts/verify-changed.mjs --files <쉼표로 구분한 경로>` | 지정 변경 경로의 빠른 검사 |

공통 품질 검사의 Prisma validate/generate는 DB migration이 아니다. 원격 개발 DB의 상태만 확인하려면 `npm run dev:check -- --allow-remote-db`를 사용한다. `check/test/build`가 Nest watch의 출력 디렉터리와 충돌할 수 있으므로 실행 중인 통합 서버를 정상 종료한 뒤 검사하고 다시 기동한다.

최신 로컬 자동 검사·개발 DB·브라우저 결과와 검증 한계는 [HANDOFF.md 1절](HANDOFF.md#1-현재-상태)에 기록돼 있다. 로컬 통과는 운영 적용이나 정식 오픈 승인을 뜻하지 않는다. 과거 날짜의 개별 실패·테스트 수는 현재 상태와 분리해 이력으로 관리한다.

## 구조와 코드 경계

```text
backend/
  src/productions/       공연·멤버·capability·준비 현황
  src/recruitment/       모집·지원·승인·처리 이력
  src/showcase/          관객 소개 게시본·출연진 공개 동의
  src/scripts/           대본·구성·주석
  src/cue-sheet/         큐·트랙·담당 권한
  src/schedule/          공연/개인 일정·참석·충돌
  prisma/                schema·migration
frontend/
  src/routes/            공개 / · /performances, 회원 /app, 운영 /admin
  src/lib/api/           REST client·session·API façade
  src/lib/domain/        순수 계산·화면 view model
  src/lib/components/    공통 UI·기능별 Presenter
scripts/local-dev.mjs    로컬 설정 검사·실행/종료
scripts/verify-changed.mjs 변경 경로 검사
tests/run-quality.cjs   공통 품질 검사
tests/smoke/            권한·계정·화면·미디어 회귀
```

프론트는 Prisma·DB에 직접 접근하지 않고 REST 계약을 사용한다. DB 조회·권한·transaction·lock·동의 처리는 백엔드 service에 두고, 순수 계산·입력 정책·응답 Presenter를 분리한다. 메뉴·화면 컴포넌트 분리가 서버 권한이나 공개 범위를 바꾸지 않도록 유지한다.

## 문서와 오픈 준비

| 문서 | 용도 |
| --- | --- |
| [LAUNCH_READINESS.md](LAUNCH_READINESS.md) | 정식 오픈 준비 항목·담당 결정·완료 근거·남은 차단 조건 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 개발 환경·DB·worker·실행기·문제 해결의 상세 안내 |
| [SITE_OPERATIONS.md](SITE_OPERATIONS.md) | 사이트·약관·고객센터·프로필 동의·미디어 CORS 운영 절차 |
| [HANDOFF.md](HANDOFF.md) | 최신 작업·실행·검증 상태와 인계 |
| [BACKLOG.md](BACKLOG.md) | 완료 카드와 보류·후속 기능 |
| [CLAUDE.md](CLAUDE.md) | 에이전트 작업 경계·위치·검사 규칙 |

`docs/`, `PRD.md`, `artifacts/`는 Git에서 제외한 로컬 참고 자료다. 화면 정의·과거 QA·캡처·로그가 로컬에 있을 수 있으나 새 체크아웃에는 포함되지 않는다. 이 README와 위 루트 문서를 기본 진입점으로 사용한다.

정식 오픈 준비는 [LAUNCH_READINESS.md](LAUNCH_READINESS.md)에서 진행한다. 개발 서버 기동과 운영 배포를 구분하고, 운영 DB·비밀값·약관·저장소·메일·백업/복구·실제 기기 검증의 완료 근거를 별도로 확인한다.
