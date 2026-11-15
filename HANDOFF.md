# 작업 인계서 — 다음 세션·다른 모델용

작성 2026-10-24. 이 문서만 읽고 이어서 작업할 수 있게 썼다. 모델·도구에 상관없이 따라 할 수 있는 절차다(Claude Code면 `/fix-cycle` 스킬과 `fixer`·`auditor` 에이전트를 그대로 쓴다).

먼저 읽을 것: `CLAUDE.md`(구조·명령·규칙) → 이 문서 → `BACKLOG.md`(카드 목록).

## 1. 현재 상태

| 항목 | 상태 |
| --- | --- |
| 브랜치 | `chore/consolidate-2026-10` — 5~14차 변경은 미커밋, push·운영 배포 없음 |
| 14차 화면 문구 | **완료** — B-114. 사용자 앱·운영 콘솔·공통 대본/연습/첨부·공개 문의/약관/게스트 문구를 자연스러운 `~해요`체로 통일하고 붙여쓰기를 바로잡음. frontend 56개 파일+회귀 기대값 1건. check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node 전체)·공개 Chrome6화면 확인·API/웹200. 기능·DB·환경·배포·커밋/push 없음 |
| 13차 실제 관리자 | **완료** — B-113. 합성 API 없이 실제 Chrome+개발 DB+private R2로 로그인→신규 공연 등록/로컬 미리보기→등록1회/이미지3장 저장→목록 포스터·준비 작업6개→새로고침/새 로그인→공연 기본 이름/장소 및 관객용 소개 별도 수정→포스터/홍보 사진2장 추가 저장→수정 목록/390px 카드/재로그인 열람.13/13·pageerror0, 미게시404·익명 Asset401 |
| 13차 QA 정리 | R2 객체5개 삭제/HEAD404·QA 공연/소개/Asset/멤버/체크리스트/알림/활동 잔존0·메일0. 새 전용 SUPER_ADMIN1명만 BLOCKED·무작위 암호 교체·세션0·이전 로그인/token401. 비활성화 증거로 QA user1·org1만 남겨 users16/org4가 됐다. 나머지12모델 count 동일·기존 계정 변경 없음 |
| 13차 검증 도구 한계 | 최초 실제 harness 전체 status는 BrowserServer close/kill promise5초 초과로FAIL이며 원본 JSON/로그를 보존했다. 기능13/13·정리PASS와 구분한다. 사후 QA node/headless process 잔존0·별도 빈 BrowserServer 종료 event/exitCode0/PID 부재/endpoint 거절 PASS. 초기 launch PID/event 미기록이라 지연 원인은 미확정. `FINAL-VERIFICATION.md/json` 판정은 `PASS_WITH_HARNESS_SHUTDOWN_LIMITATION`, 새 실제 QA는 재실행하지 않았다 |
| 13차 오픈 준비 | B-103 완료: 일괄 등록 도구의 실패 원문·성공 시 제목/파일명/객체 출력 제거, 고정 code/stage/status·숫자 집계만 출력. env/state 읽기 포함 catch·import 부작용 없음·기존 순서/skip/재시도 보존·state0600·보관 책임/정리 절차 문서화. 실제 도구/AI 실행 없음. B-109 구현 기준 운영 검토표만 SITE_OPERATIONS에 추가, 공개 정책0/signupReady=false 재확인·게시/실수신/예약은 미수행 |
| 13차 최종 검사 | 시작 snapshot `a6eba5a948d299f480d100b228c65aed44491f26`, 최종 검사 tree `b8eb84ac2673282a6604c7f99fe08252d3e53708`. check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node223)·build PASS. 실제 env 없는 snapshot·설치 deps 재사용·Prisma/cache 격리·공유 Prisma92파일 불변·application619파일 일치. B-103 새19회귀·독립 리뷰 P1/P2 없음 |
| 13차 경계·후속 | frontend/backend app·schema/migration·환경·의존성·운영 배포·외부 메일·게시·커밋·push 변경 없음. 개발 launcher 유지·API ready/웹200. `artifacts/cycle13-admin-journey/{REPORT,FINAL-VERIFICATION,CODE-REVIEW}.md`, 품질/QA/정책 JSON과 제한된 QA 화면. 배포 source·migration32개 hash 목록만 기록했고 운영 미적용 SQL·백업/복원은 미조회. 다음은 B-109 시행 문서/실수신/예약, 요청 후 후보 커밋·CI·운영 설정/복구 검토 |
| 12차 이미지 | **완료** — B-112. 관리자 신규 공연 등록·기존 공연 소개 편집에서 파일 선택/드래그 즉시 local blob 미리보기, 등록/초안 저장 때만 R2 업로드 후 글에 연결한다. 포스터1장·홍보 사진8장, PNG/JPEG/WebP 각10MB 이하. 선택·제거·취소 시 assets/R2 요청0. 게시 동작은 별도 유지 |
| 12차 실패·개인정보 | 부분 실패에서 공연 ID·완료 파일·입력을 보존해 현재 페이지에서 재시도한다. 만료된 ticket만 재예약하며 응답 유실은 저장된 최신 초안과 대조한다. 계정/공연/session 변경·화면 해제는 요청 abort·지연 응답 거부·object URL 해제로 격리한다. 최초 공연 생성 응답 유실은 기존 목록 확인이 필요하며 R2+DB 전체 원자성은 제공하지 않는다 |
| 12차 검사·리뷰 | 시작 snapshot `7ffd0ac6d8ff90b10925f54f0492b731ac12ea34`, 최종 검사 tree `4a777b99e84d9302610290cc947f94fdedc6baf3`. check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node204)·build PASS. 실제 env 없는 snapshot·설치 deps 재사용·Prisma/cache 격리·공유 Prisma92파일 불변·application618파일 일치. 독립 리뷰 미해결 P1/P2 없음·Svelte autofixer issues0 |
| 12차 브라우저 | 합성 API Chrome11/11(관리자 등록·취소·부분 실패·409·계정/공연 전환), 실제 개발 DB/R2 Chrome6/6(일반 PRODUCER·선택 전송0·저장3장·hash/HEAD·재로그인·교체/제거·공개404/익명401), pageerror0. 실제 신규 SUPER_ADMIN 등록 경로는 실행하지 않았다 |
| 12차 정리·경계 | QA R2 객체4개 삭제/HEAD404·QA행 잔존0·기존11모델 count 동일·메일0. 전용 일반 QA 계정만 사용·기존 계정/SUPER_ADMIN 변경 없음. backend·schema/migration·환경·의존성·배포·커밋·push 변경 없음. README/SITE_OPERATIONS/LAUNCH/BACKLOG 갱신, `artifacts/cycle12-image-staging/{REPORT,BROWSER-QA}.md` 및 JSON·로그. 초기 QA fixture 실패·정확한 ID 정리는 성공 결과와 분리 기록 |
| 11차 R2 | **완료** — B-76·B-110·B-111. 사용자 승인 후 `attachment` 버킷 Object Read & Write 전용 키를 발급해 backend/.env에 설치하고 개발 서버를 재기동했다. 기존 키는 프로젝트 전용 확인 후 폐기했다. Cloudflare DELETE200·기존 키 S3 **401 Unauthorized**/관리 GET404·새 키 S3/관리200으로 확인했다. root 관리 키는 변경하지 않았다 |
| 11차 파일 경로 | 신규 `art-bridge/{용도}/{UTC연도}/{고유값-파일명}`, 빈 R2_KEY_PREFIX, `R2_LEGACY_PROJECT_NAMES=reading-musical`. 같은 버킷의 기존 경로만 읽고 DB storageKey·기존 객체는 이동하지 않았다. 이전 객체 count26 유지, 합성 legacy 파일로 실제 읽기 검증. bucket·CORS 공개 설정 변경 없음, 신규 art-bridge/ 폴더 marker0B만 유지 |
| 11차 실제 화면 | 폐기 전·후 Chrome 앱11/11 PASS. 실제 일반 PRODUCER 로그인→파일 첨부→원본 hash/Range206/CORS→legacy 재사용→탭 이동→새로고침→다시 로그인·재열람·익명401. 첨부 후 자식 remount가 부모 전송 잠금을 남기는 B-111을 발견·수정했다. pageerror0·QA 객체/행 잔존0·기존 users15/productions33/memberships39·전체8모델 count 동일·메일0 |
| 11차 최종 검사 | 시작 snapshot `ccd3848eda2fba63ae30adee93e31715c0b15ca6`, 최종 검사 tree `71da98380992f9c453cdc2722ea770aa2e8c79d4`. check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node187)·build PASS. 실제 env 없는 snapshot·설치 deps 재사용·공유 Prisma92파일 불변·source615파일 일치. fresh npm ci·실제 CI·운영 배포 결과는 아님. 독립 리뷰 P1/P2 없음·Svelte autofixer issues0 |
| 11차 비밀·기록 | 임시 키 사본 제거, backend/.env0600·실제 env 미스테이징·검증 출력의 credential 일치0. `artifacts/cycle11-r2/REPORT.md`, key-revocation/storage/browser/quality JSON·로그·합성 화면. 최초403 한정 판정은401도 인증 거부임을 확인해 보완했다. 읽기 재검증 명령 거절 후 사용자 재허용 범위에서 확인했다 |
| 11차 경계·다음 | 실제 Cloudflare 앱 키 교체와 개발 환경 설정만 반영했다. 운영 DB/migration·배포·외부메일·정책 게시·커밋·push 없음. 남은 오픈 준비는 B-103 도구 오류 출력, B-109 정책/실수신/예약, 요청 후 후보 커밋·CI·운영 환경 새 키/경로 검토와 백업/복구다 |
| 10차 사이클 | **신규 가입 이메일 인증 구현·검증 완료** — 사용자 결정 B-102, B-104~B-108. 시작 snapshot `682fda15c604e29d6a085ba36f2f1accd20051e3`, 최종 application tree `328cefbb649cef83f15bd29d6de703038f98b05c`. 코드 확인 전 계정/token을 만들지 않고 최종 가입 때 proof·동의·계정 생성을 같은 transaction으로 처리한다. 기존 User 상태·로그인/refresh·초대 수락·복구는 유지했다 |
| 10차 인증·개인정보 | 6자리 코드10분/실패5회·재전송60초/메일함별10회/h, proof10분·단회. 원문 이메일 식별은 유지하고 발급 제한만 case-insensitive. 코드 HMAC·proof hash 저장, 발급과 outbox 원자성·메일 보류 write0. worker는 현재 코드/수신자를 재검사하고 완료/말단 실패/중단 말단 복구의 본문을 제거한다. 별도 파기 명령은 24h 만료 challenge·가입 메일 삭제/처리 중 익명화, 10분 만료 본문 정리를 bounded batch로 수행한다 |
| 10차 DB | 사용자 명시 승인 후 개발 DB에 `20261023180000_registration_email`만 적용했다. 신규 테이블1개·index·제약과 이력만 같은 transaction에 기록. users15/productions33/memberships39 전후 동일·새 테이블 초기0건. 운영 적용 없음. `migration-applied.json` 참고 |
| 10차 최종 검사 | 별도 최종 snapshot에서 check PASS(Svelte0/0)·test PASS(87 suites/880 tests+Node 회귀182건)·build PASS. 실제 env 없는 폴더에서 설치 deps 재사용·Prisma/cache 격리·검사 중 공유 Prisma92파일 불변. fresh npm ci·실제 GitHub CI는 아니다. 이후 정상 재기동에서 신규 workspace Client를 생성했다. 공식 Svelte autofixer issues0, 독립 코드 리뷰 미해결 P1/P2 없음 |
| 10차 실제 QA | PostgreSQL50/50(가입/동의/복구/실제2연결 row·advisory lock35+파기SQL/DbNull/CAS15), QA 잔존0·기존 데이터 count 불변. 정책 fixture는 미커밋 transaction 안에서만 사용, 별도 동시검증 challenge1개는 ID+email 한정 삭제했다. 합성 API 실제 브라우저16/16·계약검사73건 PASS(pageerror/외부요청/390px overflow0). 초기 OTP DOM pattern 오류를 수정해 전체 gate·브라우저 재검증. 기존 회원·초대·복구와 commit 후 layout 재마운트 continuation 확인 |
| 10차 runtime·경계 | 소유 launcher 정상 종료→격리 gate→정상 재기동 완료. API ready/웹200·익명 me401·신규 인증/가입 필수입력422 확인. 개발 정책 API200·공개 정책0·signupReady=false 보호 유지. 기존 계정 변경·실제 정책 게시·외부메일·일반 파기 worker 실행·R2/환경 변경·운영 배포 없음. 파기 SQL QA만 명시 ID scope+rollback으로 수행했다 |
| 10차 기록·후속 | `artifacts/cycle10-email-verification/{REPORT,CODE-REVIEW,DB-INTEGRATION,browser-verification}.md`·최종 snapshot/DB/browser/runtime JSON. README/DEVELOPMENT/SITE_OPERATIONS/LAUNCH/BACKLOG 갱신. B-76 키 교체·B-103 도구 오류 출력·B-109 실제 가입 정책/수신·예약 작업이 남는다. 다음 운영 준비는 대상과 구체 변경 범위를 확인해 진행한다 |
| 9차 오픈 준비 | **README·개발/운영 문서·CI 정리 완료** — B-99~B-101. 현재 기능·역할·명령·문서 지도를 갱신하고 과거 실패 기록을 현재 상태와 분리했다. `LAUNCH_READINESS.md`에 공개 범위·준비 순서·완료 근거·중단/복구·실제 사용자 리허설을 정리했다. CI는 임시 PostgreSQL migration 뒤 canonical check/test/build를 실행한다 |
| 9차 보존·검증 | 시작 snapshot `befbddcdeddaed71f2498b8c13c5eb0595bc8efe`. 문서·CI만 변경했고 app source·schema·환경·runtime은 유지했다. snapshot을 별도 폴더에 풀어 check PASS(Svelte0/0)·test PASS(83 suites/785 tests+회귀)·build PASS. 설치된 deps 재사용이며 fresh npm ci·실제 GitHub Actions·컨테이너 검증은 아니다. 공유 Prisma92파일 불변, 문서 링크·npm 명령·workflow 구문 검사 PASS |
| 9차 운영 경계 | 실제 운영 DB·설정·키·약관 게시·메일·scheduler·백업/복구·실물 기기는 미검증이었다. 로컬 공개 정책 API200·setupRequired=false·공개 정책0개 확인. 9차 당시 가입은 이메일 소유 인증 없이 ACTIVE 계정+token을 발급해 B-102를 등록했고 10차에서 구현했다. B-76 키 교체와 후보 revision 확정은 오픈 전에 남는다 |
| 9차 기록·다음 순서 | `artifacts/launch-preparation/{REPORT,RELEASE-AUDIT,PRIVACY-OPERATIONS-AUDIT,SNAPSHOT-QUALITY}.md`. 오픈 범위/가입 정책 → 키 교체 → 요청 후 후보 커밋·CI → 백업/복원·배포 경로·migration 검토 → 정책/저장소/메일/기기 리허설. 각 운영 변경은 실제 대상·절차와 승인 범위 확인 후 실행한다 |
| 8차 사이클 | **최종 화면·권한 감사 및 동작 보존 리팩토링 완료** — B-86~B-98. 개인 주석·중첩 연락처·임의 프로필/참석 정보·현재 사진·기획 메모·삭제 대본·socket 현재 권한과 Client 계정 경계 보완. 기능별 서버 capability에 맞춰 메뉴·설정·멤버·배역·일정 버튼 정리, 승인 이력/현재 연결과 기타 직무 입력 구분 |
| 8차 시작·구조 | snapshot `4671c00ab1d6f6337fa779718285bf205abee177`. DB/권한/transaction/lock/동의는 service에 유지하고 readiness 순수 계산·모집/소개 문서 정책·Presenter·navigation을 분리했다. 수정 코드 주석은 존대 없이 의도·불변 조건·개인정보 경계를 기록했다. schema·migration·환경·의존성 변경 없음 |
| 8차 계정·자료 경계 | 늦은 refresh/응답·SWR·이전 layout redirect·프로필 checksum/저장·미디어 batch/첨부/큐·CSV import 전체를 시작 owner/session에 결합했다. 같은 계정 refresh는 초안 보존. 다른 계정의 refresh 응답은 거부. 새 QA 계정 생성/활성화·R2·메일·공개 게시 없음 |
| 8차 최종 검증 | check PASS(Svelte0/0)·test PASS(83 suites/785 tests+기존 회귀·신규 Client/미디어/화면56건)·build PASS, API 경계327파일 PASS. 공식 Svelte autofixer issues0. 실제 개발 PostgreSQL23/23(임시21행 전부 rollback·잔존0), 최종 재기동 뒤 합성 API 실제 브라우저9/9(pageerror0·390px overflow0) PASS. 기존 테스트 assertion/시나리오는 보존하고 새 session/Client façade를 실행 경로에 연결했다 |
| 8차 runtime·기록 | 정상 launcher 재기동 완료. API `/health/ready`200(DB ok)·웹5179 200·익명 access/일정/모집401·공개 공연200. `artifacts/cycle8-refactor/{REPORT,CODE-REVIEW,CLIENT-INDEPENDENT-REVIEW}.md`·최종 gate/브라우저/DB JSON. 정상 launcher는 `sh dev.sh --allow-remote-db`이며 Nest watch와 build dist 충돌을 피하려 종료→gate→재기동을 유지 |
| 8차 화면 정의·후속 | `docs/plans/final-screen-definition.md`·PRD v2.1에 실제 route/기능/권한/공개 범위와 미구현 화면을 분리했다(기존 정책대로 로컬 docs/PRD는 gitignore). 전용 동시 리딩·독립 진행표·무대 배치·일정 수정 UI 등은 후속. B-76 키 교체·선택 프로필 수집 안내 게시·운영/실물 기기/외부 메일 검증은 이번 완료 범위에 포함하지 않는다 |
| 7차 사이클 | **구현·자동 검사·실제 브라우저/DB 검증 완료** — B-77~B-85. 조직·기본 직군 불문 배우·스태프 모집/지원/검토/추가 검토/승인/미선정/철회. 승인 시 ACTOR/STAFF만 역할 merge, 내 일정→참여 공연 홈 유지. 재지원·모바일 상세 이동·현재 멤버십 안내와 취소창 B85 수정·실제 재검증 완료 |
| 7차 시작 보존 | snapshot `13683d713022eaa2e609cae6e04b8517fe9ac265`. 기존 5·6차 미커밋 변경 보존, 새 의존성 없음. 계약 `docs/plans/cycle7-recruitment.md`(로컬), 카드 BACKLOG B-77~B-85 |
| 7차 DB 경계 | 사용자 새 명시 승인 후 `20261023120000_recruitment`만 분리 개발 DB에 적용 성공. BEGIN/COMMIT 포함 신규 4테이블·3enum. 기존 users7/productions26/memberships28 행 수 전후 동일, 기존 행 DML·운영 적용 없음. `artifacts/cycle7-recruitment/migration-applied.json` |
| 7차 검증 | B85 보완 뒤 전체 check PASS(Svelte0/0)·test PASS(70 suites/658 tests+기존 회귀)·build PASS. 공식 Svelte autofixer issues0. 실제 PostgreSQL11/11·DBONLY 자기 공연정리3/3·브라우저기능19/19·after12/12 PASS(overflow/pageerror0). 조직·대표 역할·기존 역할 보존, 동시 정원/멱등 승인/취소·철회 경합, 로그인 일정 우선 확인 |
| 7차 실제 화면·계정 | `artifacts/cycle7-recruitment/{REPORT,CODE-REVIEW,DB-INTEGRATION,BROWSER-REPORT,INDEX}.md`·최종 gate 로그. 브라우저 QA 모집7개 CANCELLED·미처리0·승인멤버2명 유지, 공개소개0·메일0. 신규 QA8개 BLOCKED·세션0·무작위 암호 hash 교체·이전 암호/token8/8 401·fixture 암호 제거. 기존 전용 관리자 BLOCKED·세션0·이전token/API/브라우저401. 기존 일반 계정·관리자 암호 미변경 |
| 7차 QA 출력 정리 | 신규 QA 공유 임시 암호의 tool 출력은 B84로 기록·사용자 고지 후 해당8개 계정만 암호 교체·차단·세션 철회로 정리했어요. 실사용 계정·운영/R2 변경 없음. 실물 기기·운영 배포·신규 가입 전체/외부 메일은 미검증 |
| 7차 최종 runtime | QA 정리 뒤 launcher 정상 종료→최종 check/test/build PASS→정상 재기동 완료. 웹5179·API /health/ready 200, 기존 QA 관리자 token401·익명 모집401·관객 소개200/총0개. `artifacts/cycle7-recruitment/post-gate-results.json` 참고 |
| 6차 사이클 | **구현·브라우저 검증 완료** — 사용자 첨부 화면 요청. B-71~B-75: ECharts 운영 대시보드, 포스터·등록 상태 버튼, 공연별 sidebar, 홍보 초안/게시/공개 소개, 배우별 이름·사진 공개 선택. 기획 에이전트 검토와 P1/P2 보완 완료 |
| 6차 시작 보존 | snapshot `db25acbf1292d78d0020b044bb0075239d93ffa0`, 5차 작업 보존. 신규 의존성 ECharts 6.1.0만 추가 |
| 6차 DB 경계 | 사용자의 명시 승인 후 분리 개발 DB에 `20261023090000_performance_showcase` 적용 성공. `production_showcases`·`performance_credit_consents` 두 테이블만 추가, 기존 행 자동 공개 없음. 실제 PostgreSQL 동시 저장·초안/공개본·KST 정렬·offset 8개 PASS. DBONLY QA 공연4개는 비공개·soft delete 정리 |
| 6차 검증·계정 | 최종 check PASS(Svelte0/0), test PASS(63 suites/566 tests + 기존 회귀·대시보드4), hash/404 보완 후 최종 build PASS. 브라우저 운영12·편집7·동의6·공개10·권한3·포스터4·hash4·저장스크롤1·실제정렬1·after16 PASS(기능48/48). QA 소개4개 비공개·동의false·사진원복, 전용관리자 BLOCKED/세션0/이전token·API·브라우저401. 정상 launcher 재기동 완료: API /health/ready200(DB ok)·웹5179 200·공개목록200. QA 소개 정리 후 공개0개 |
| 6차 증거·제한 | `artifacts/cycle6-showcase/{REPORT,INDEX,BROWSER-REPORT,DB-INTEGRATION}.md`. 신규 프로필 사진 수집은 약관 미게시로503을 유지하며 직접 만든 QA사진 fixture로 공개 동의·재확인·철회만 실제 UI/API 검증. 실물 mobile·운영 배포는 미검증 |
| 6차 보안 후속 B-76 이력 | QA fixture 초기 오류가 R2 키를 tool 반환에 포함해 오류 처리를 수정했다. 값은 문서·artifacts에 기록하지 않는다. 11차에서 앱 전용 키 교체·기존 키 폐기와 실제 접근 차단 확인을 완료했다 |
| 5차 사이클 | **완료 (2026-10-23)** — 사용자 요청: 배우·스태프가 바로 쓰고 관리자도 쉽게 등록하는 화면과 자연스러운 문구. B-64~B-70, backend·API·schema·의존성 변경 없음 |
| 시작 상태 보존 | 5차 시작 전 `sh scripts/agent-snapshot.sh save`, 스냅샷 `9c4181604de61b5802a08019894d9c2264d7673a` |
| 배우·스태프 | 내 공연에서 다음 일정·참석 응답을 먼저 확인. 배우는 대본/개인 연습, 스태프는 큐시트 우선. 읽기 기본 1.1rem·배정 배역 강조, 모바일 연습 조작 우선·영상 접기. 기존 전체 공연 개인 기록 `overview` 저장 범위 보존 |
| 관리자 | 공연 이름 우선 등록 → 대본·자료 → 멤버·배역 → 일정 → 연습. 등록 query 소비, 잘못된 문의/일정 링크 수정. 멤버·배역·설정과 보조 운영 7화면의 상태·입력·문구 정리 |
| 일상 작업·공통 UI | 일정 기간/공연 필터, 공연팀 검색·허용된 연락처, 알림/프로필 오류 복구, 게시판 공유 범위·초안 이탈 확인. 공통 대비·터치 영역·skip link, 큐/트랙 삭제와 체크리스트 확인창·입력 보존·공연 전환 guard |
| 5차 품질 검증 | 최종 `npm run check`·`npm run test`·`npm run build` 모두 PASS. Svelte 오류·경고 0, 61 suites/514 tests와 기존 회귀 + 새 reader7/checklist20 통과. 기존 테스트 본문은 수정하지 않았어요. 공식 Svelte MCP issues 0. build의 생성된 SSR unused-import 경고는 남지만 성공 |
| 5차 화면 검증 | before64/after68 캡처 + 실제 역할별 desktop/mobile6. 기능38/38·역할6/6·등록 cold2/2 PASS. mobile 홈423→390px·긴 멤버명425→390px. primary light 4.710/hover5.581, 실제 dark 9.074/hover9.714. skip link·뒤로/앞으로·문의 상세 GET 안정·개인 기록 보존 확인 |
| 5차 증거 | `artifacts/ux-refresh/REPORT.md`, `INDEX.md`, `BASELINE.md`, 캡처·DOM·기능 결과 JSON·final-check/test/build.log. artifacts는 gitignore로 로컬 보관 |
| 테스트 데이터·계정 | 사용자가 확인한 분리 개발 DB의 QA 공연·계정만 사용. 기존 전용 SUPER_ADMIN은 최종 BLOCKED·활성 세션0·이전 access token/API 재로그인/실제 로그인 화면 모두401 확인. 신규 SUPER_ADMIN 없음. QA 일반 STAFF·공연1개·연습/메모 fixture는 재현용으로 보존 |
| 런타임 | 로컬 API `127.0.0.1:3000`, 웹 `127.0.0.1:5179`. 전체 gate의 Nest build와 watch dist 충돌을 피하려 dev 종료 → gate → 재기동 순서 사용. 환경·migration·운영/R2 설정 변경 없음 |
| 3차 사이클 | **완료** — B-39~B-60, 커밋 `10677ad`·`17b8a10`. 최종 check/test/build PASS(61 suites/514 tests 등). 실DB 회귀 4건·desktop20/mobile4·게스트 철회/공연삭제 접근 종료 PASS |
| 실제 MP4 (3차) | `artifacts/cycle3/cycle3-export-60s.mp4`: 60.0389초, H.264 1280×720·AAC, 30,712,730 bytes. 브라우저 끝부분 seek·재생·소리, 별도 영상+음원 혼합5초 PASS. `artifacts/cycle3/REPORT.md` 참고 |
| 4차 사이클 | **구현·커밋 완료** — B-61~B-63, `7a0363b`·`8683962`·`ae44860`. 공통 UI·ConfirmDialog·touch 크기·Storybook 46개. 5차에서 재사용·확대 적용 |
| 재기동 최종 확인 | 공개200·차단된 관리자401·ACTOR desktop/mobile 인쇄(새 main 여백0·대본 표시·shell 숨김) PASS. `post-gate-smoke-results.json`·인쇄 PDF 보존 |
| 별도 범위 | 5차 요청 범위는 완료. BACKLOG 보류의 schema/API 기능, 미점검 backend 감사·큰 파일 분할은 별도 작업 |
| 검증 경계 | 로컬 앱 + 분리 개발 PostgreSQL + Chrome. 운영 배포·실물 mobile/iOS 검증 없음. 기존 약관 내용·동의 payload·연락처 공개 범위·개인 메모 권한은 유지 |

## 2. 사용량 판단 (Claude Pro 기준, 2026-10-23 측정)

- 5시간 한도 83% 사용(17% 남음, 측정 약 2시간 뒤 초기화). 주간 한도 23% 사용(77% 남음).
- 이번 세션 실측: Sonnet 감사 에이전트 1개 약 16만~24만 토큰, Sonnet 수정 에이전트 1개(카드 1~5장) 약 3만~11만 토큰. 두 차례 사이클(감사 2 + 수정 15묶음)로 5시간 한도 대부분을 썼다.

| 단계 | 예상 사용량 | 남은 17%로 가능? |
| --- | --- | --- |
| 1. 커밋 정리 | 작음(git 명령 위주, 파일 내용 거의 안 읽음) | **가능** |
| 2. 화면 확인 | 중간~큼(브라우저 스크린샷·페이지 읽기가 비쌈) | 일부만. 초기화 뒤 권장 |
| 3. 미점검 영역 감사 | 큼(감사 에이전트 2~3개) | 불가. 초기화 뒤 |
| 4. 큰 파일 분할 | 큼(파일당 수정 에이전트 1개 + 검증) | 불가. 초기화 뒤, 하루 1~2개 파일씩 |

**권장:** 지금 남은 17%로 1단계(커밋 정리)만 끝낸다. 2~4단계는 5시간 한도가 초기화된 뒤 단계마다 **새 세션**으로 시작한다. 긴 세션은 매 턴 이전 대화를 다시 보내므로, 단계마다 새로 시작하는 편이 토큰이 덜 든다. 실행은 Sonnet, 판단이 필요한 리뷰만 상위 모델이 맡는다.

## 3. 작업 전에 처리할 것 (사용자 결정 필요)

**2026-10-23 결정 완료:** artifacts는 gitignore, SITE_OPERATIONS.md는 커밋, 날짜 붙은 점검 보고서 6개는 `docs/reports/`(로컬 보관)로 이동, 브랜치 `chore/consolidate-2026-10`, push 안 함. 아래는 기록용이다.

다음은 모델이 임의로 정하지 말고 사용자에게 먼저 물어본다.

1. **`artifacts/`(8MB, 화면 캡처·검증 로그)를 커밋할지** — 권장: 커밋하지 않고 `.gitignore`에 추가.
2. **루트 보고서 7개를 커밋할지** (`COMMUNITY_QA.md`, `DEPLOYMENT_READINESS_2026-10-09.md`, `IMPROVEMENTS_2026-10-09.md`, `PRE_DEPLOY_REVIEW_2026-10-09.md`, `REHEARSAL_QA.md`, `RELEASE_RECHECK_2026-10-09.md`, `SITE_OPERATIONS.md`) — 권장: `SITE_OPERATIONS.md`는 운영 문서라 커밋, 날짜 붙은 점검 보고서는 `docs/`(gitignore 대상)로 옮기거나 함께 커밋.
3. **루트의 옛 `.env` 파일** — gitignore라 커밋되진 않지만 이전 점검에서 사용자가 삭제하기로 한 파일. 모델이 지우지 않는다.
4. **브랜치 이름** — `main`에 직접 커밋하지 않는다. 권장: `chore/consolidate-2026-10`.
5. **push·PR 여부** — 커밋까지만 하고 push는 사용자 확인 후.

작업 전 기술 점검:

- `git status`로 위 목록과 실제 상태가 같은지 확인한다. 다르면 멈추고 보고한다.
- `.env`, `.env.*`(예시 파일 제외)가 스테이징되지 않는지 확인한다: `git diff --cached --name-only | grep -E '(^|/)\.env' | grep -v example`가 비어 있어야 한다.
- 대화형 git 명령(`git add -p`, `rebase -i`)은 쓰지 않는다. 한 파일 안에서 이전 작업과 이번 수정은 분리할 수 없으므로 **파일 단위로 묶어 커밋**한다.

## 4. 단계별 절차

### 1단계 — 커밋 정리 (완료)

주의(실제로 겪음): 이전 작업이 인덱스에 미리 스테이징해 둔 변경이 있으면 첫 커밋에 섞인다. 시작 전에 `git diff --cached --name-only`가 비었는지 확인하고, 비어 있지 않으면 `git reset`(작업 트리 유지)으로 스테이징만 비운다.

목표: 미커밋 변경을 영역별 커밋 몇 개로 나눠 되돌리기·리뷰가 가능한 상태로 만든다.

1. 브랜치 생성: `git switch -c chore/consolidate-2026-10`.
2. 아래 순서로 `git add <경로>` 후 커밋한다. 커밋 메시지는 기존 형식(`feat:`/`fix:`/`chore:` + 영어 한 줄)을 따른다.
   1. DB: `backend/prisma/schema.prisma`, `backend/prisma/migrations/`, `backend/prisma.config.ts` — `feat: add schema for rehearsal, community, site support and production lifecycle`
   2. 백엔드: `backend/src`, `backend/scripts`, `backend/package.json`, `backend/package-lock.json`, `backend/Dockerfile`, `backend/.env*.example`, `backend/mail-deployment.example.json` — 영역이 넓으면 `backend/src/<모듈>` 단위로 2~4개 커밋으로 나눠도 된다.
   3. 프론트: `frontend/` 전체(삭제된 옛 화면 48개 포함, `frontend/static` 아이콘 포함).
   4. 테스트·도구: `tests/`, `scripts/`, 루트 `package.json`, `dev.sh`.
   5. 작업 체계: `CLAUDE.md`, `HANDOFF.md`, `BACKLOG.md`, `.claude/agents`, `.claude/skills`, `.claude/settings.json`, `.gitignore` — `chore: add agent workflow (Opus review, Sonnet fixer) and backlog`
   6. 문서: 3절에서 결정한 대로.
3. 중간 커밋은 단독으로 빌드되지 않을 수 있다(DB·백엔드·프론트가 서로 의존). 마지막 커밋 뒤에 `npm run check`와 `npm run test`를 한 번 돌려 통과를 확인한다.
4. `git status`가 비었는지(또는 3절에서 제외하기로 한 것만 남았는지) 확인하고 보고한다.

완료 조건: 작업 트리가 깨끗하고 게이트가 통과하며 커밋 목록을 사용자에게 보여 줬다.

### 2단계 — 화면 확인

목표: 단위 테스트로만 확인한 수정이 실제 화면에서 동작하는지 본다.

준비: `sh dev.sh --allow-remote-db`(자세한 내용은 `DEVELOPMENT.md`). 테스트 계정은 `backend/prisma/seed.ts`에 있는 시드 계정을 쓴다(운영 DB 금지).

확인 목록(카드 번호는 `BACKLOG.md` DONE):

- 큐시트(`/app/p/<pid>/cuesheet`): 큐를 끌어 옮긴 뒤 재생 위치·확대·스크롤이 유지되는지(B-01), 큐 삭제 시 확인창이 뜨는지(B-02), 다른 공연으로 이동하면 이전 공연 큐가 사라지는지(B-03).
- 공연 관리(`/app/p/<pid>/manage/settings|members|casting|planning`): 공연 A → B 이동 후 B의 데이터만 보이는지(B-10, B-12). 네트워크를 끊었을 때 "권한 없음"이 아니라 오류+다시 시도가 나오는지(B-11).
- 관리자(`/admin/members/<id>`, `/admin/productions`): 조회 실패 시 빈 화면 대신 오류 화면(B-06, B-07), 삭제 확인창(B-08).
- 일정(`/app/schedule`, `/app/p/<pid>/schedule`): 조회 실패 패널(B-14), 개인 일정 삭제 확인(B-15).
- 게스트 링크(`/r/<token>`): 관리자가 링크를 철회하면 게스트 화면 연결이 바로 끊기는지(B-19), 공연을 삭제하면 끊기는지(B-37).
- 비밀번호 변경: 같은 비밀번호로 바꾸면 거부되는지(B-21).

결과는 `BACKLOG.md`에 "화면 확인 YYYY-MM-DD" 줄로 남기고, 실패는 새 카드로 TODO에 추가한다.

선택: `tests/smoke/frontend-screen-smoke.cjs`는 삭제된 옛 화면을 대상으로 해 쓸 수 없다. 위 목록을 현재 `/app`·`/admin` 기준 Playwright 스모크로 다시 쓰면 다음부터 화면 확인 비용이 크게 준다(별도 카드로 처리).

### 3단계 — 미점검 영역 감사

이번 감사는 큰 파일 위주였다. 아래 범위가 남았다. 범위마다 감사 에이전트(Sonnet, 읽기 전용) 1개, 결과는 `BACKLOG.md` 카드로.

1. 백엔드: `run-sheets`, `music`, `casting`, `board`.
2. 백엔드: `inquiries`, `site`, `assets`(R2·서명 URL), `ai`(외부 모델 무응답·지연 처리).
3. 프론트: `lib/components/app/composition-*`, `rehearsal-*`, `scene-line-editor.svelte`, 그리고 `~습니다`/`~해요` 혼용이 남은 화면.

Claude Code: `/fix-cycle audit`. 이미 고친 항목(`BACKLOG.md` DONE)은 감사 프롬프트에 넘겨 중복 보고를 막는다.

### 4단계 — 큰 파일 분할

수정할 때마다 큰 파일을 읽느라 토큰이 많이 든다. 동작을 바꾸지 않는 분할만 한다. 한 번에 한 파일, 파일마다 새 세션.

| 파일 | 줄 수 | 분할 방향 | 안전망 |
| --- | --- | --- | --- |
| `backend/src/productions/productions.service.ts` | ~2,200 | 멤버(add/update/remove)·초대·삭제/복구·검색을 별도 서비스로. 컨트롤러는 위임만 | `productions-add-members`, `productions-invitations`, `productions-soft-delete` spec |
| `frontend/src/lib/components/app/cue-studio.svelte` | ~1,850 | 타임라인 레인·인스펙터·재생 제어를 하위 컴포넌트로, 계산은 `lib/domain`으로 | svelte-check, `tests/smoke/*timeline*` |
| `frontend/src/routes/app/p/[pid]/cuesheet/+page.svelte` | ~1,370 | 로딩·서명 URL 관리를 `lib/hooks` 또는 모듈로, 다이얼로그를 컴포넌트로 | svelte-check, 2단계 큐시트 확인 목록 |

규칙: 분할 전후 공개 API·라우트·응답 형태가 같아야 한다. 분할 커밋에 기능 변경을 섞지 않는다. 끝나면 `npm run check && npm run test`, 프론트는 2단계 해당 항목을 다시 확인한다.

## 5. 반드시 지킬 것 (이번 작업에서 배운 점)

- **수정 에이전트를 띄우기 전에 스냅샷**: `sh scripts/agent-snapshot.sh save` → 리뷰는 `sh scripts/agent-snapshot.sh diff <파일>`. 지금은 작업 트리가 깨끗하므로, 사이클마다 커밋하면 `git diff`로도 충분하다.
- **빠른 검증은 변경 파일만**: `node scripts/verify-changed.mjs --files a,b`. 전체 게이트는 사이클 끝에 한 번.
- 병렬 수정 에이전트는 서로의 미완성 파일 때문에 tsc가 잠깐 실패할 수 있다. 자기 파일 오류가 아니면 무시하고 마지막 전체 게이트로 확정한다.
- 에이전트가 "파일을 복구했다"고 보고하면 스냅샷 diff로 기존 작업이 지워지지 않았는지 꼭 확인한다.
- 운영 DB·환경 파일·migration 적용 금지. 스키마 변경이 필요하면 멈추고 보고.
- 사용자 화면 문구는 `~해요`체, 삭제는 확인 후 실행, 삭제된 옛 라우트 링크는 되살리지 않는다.

## 6. 새 세션 시작 문장 (복사해서 사용)

3차 사이클(2026-10-23 사용자 요청):

```
HANDOFF.md와 BACKLOG.md를 읽고 3차 사이클을 진행해줘.
1) auditor 2개로 B-41(대본 관리)·B-42(일정 관리)를 병렬 감사하고 결과를 카드로 추가
2) fixer로 B-40(MP4 내보내기)을 구현 — 카드의 설계를 그대로 따를 것
3) 감사 카드와 B-39를 fixer로 수정, 끝나면 npm run check·test 후 커밋(push 안 함)
4) 마지막으로 2단계 화면 확인 목록과 MP4 1분 녹화를 브라우저로 확인
시작 전에 sh scripts/agent-snapshot.sh save, 끝나면 HANDOFF.md 1절과 BACKLOG.md 갱신.
```

일반:

```
HANDOFF.md를 읽고 <N>단계를 진행해줘. 3절의 결정 사항 중 정해지지 않은 것은 먼저 물어봐.
수정은 Sonnet fixer 에이전트로, 리뷰와 결정은 네가 맡아. 끝나면 HANDOFF.md 1절 상태와 BACKLOG.md를 갱신해.
```
