# 개선 백로그

`/fix-cycle`이 관리한다. 카드 형식과 처리 순서는 `.claude/skills/fix-cycle/SKILL.md` 참조. 경로 앞 `FE/` = `frontend/src/`, `BE/` = `backend/src/`.

## TODO

### B-109 [high][운영 준비] 가입 인증 실수신·안내 문서·파기 예약
- 근거: 코드·개발 DB·합성 브라우저 검증은 완료했지만 공개 정책0개·signupReady=false이며 실제 외부 메일 수신과 운영 scheduler는 확인하지 않았다.
- 완료 조건: 실제 가입 인증 수집 항목/메일 처리/24시간 파기 대상을 안내 문서에 반영하고 검토 후 게시한다. 승인된 테스트 수신자에게 발송·재전송·만료·스팸 처리를 확인한다. 기존 큐 검토·발송 보류 해제·worker와 별도 registration:purge:prod 예약/실행·집계·백업/외부 provider 보관 기준을 확인한다. 실제 대상·수신자·변경 범위 승인 없이 실행하지 않는다. B-76 개발 앱 키 교체는 11차에서 완료했다. 운영 환경의 새 키 반영·실제 메일·예약 작업은 별도 확인한다.
- 13차 준비: `SITE_OPERATIONS.md`에 구현 기준 수집 항목·10분/24시간 처리·PROCESSING 익명화·외부 provider/백업·담당자 확정 근거표를 추가했다. 개발 공개 정책0개·signupReady=false를 재확인했다. 실제 시행 문서 게시·실수신·운영 예약은 미수행이다.

## 보류 (이번 사이클 제외 — 사용자 결정·큰 작업)

- 실제 선택 프로필 수집 안내(PROFILE_PRIVACY) 준비·게시 후 신규 사진 업로드 전체 여정 확인. 현재 미게시라 POLICY_NOT_READY503 보호가 유지되며, 6차 사진 공개 검증은 직접 만든 QA Asset fixture로 준비했어요.

- 스키마 변경 필요(승인 전 금지): 반복 일정(recurrence/groupId), 출석 응답 마감 `ScheduleEvent.rsvpDueAt`+"다시 알림", `ScheduleEvent.notes`(준비물).
- [feature][M] 일정 참석자 선택·장면/음악 연결·suggest 활용, 모바일 달력 스와이프·주간 스트립, 시간 입력 편의(종료 자동 이동·빠른 선택).
- [feature][M] 대본 버전 저장·비교·되돌리기 UI(선행: B-43), 줄 주석·메모 UI와 공유 범위, 막·장면 이름 변경/삭제/이동/복제 API+UI.
- [feature][S] 수정 이력(ActivityLog 재사용, 스키마 변경 없음), 낭독 설정 확장(줄 간격·고대비·wakeLock), 편집 저장 상태 배지·모두 저장.
- 결정 필요: 제작진 메모(`※` 줄·NOTE 블록)를 서버에서 GUEST·ACTOR에게 숨길지(현재는 FE 체크박스만), 구간 복제·가져오기가 `sourceSceneId`/`sourceScriptId`를 복사해 한쪽 수정 시 다른 쪽이 DIVERGED/덮어쓰기되는 문제의 처리 방식, 가져온 대사에 `characterId` 자동 연결, 일정 응답을 끝난 일정에서 막을지, getMySchedule 기간 제한(from/to), 개인 일정 하루종일 저장 방식(23:59→다음 날 00:00), 일정 삭제 시 영향 경고(force 없이 먼저 호출), 리마인더 루프 일괄 처리.
- 낮은 우선: restoreVersion 트랜잭션 안 영향 재계산, `GET scenes/:id/blocks` 단건 API, 공용 ConfirmDialog로 composition-workspace의 `window.confirm` 5곳 교체.

## DONE

### B-115 [med] 공연 일정 수정과 메일 발송 보류 표시 (2026-11-13)
- 완료: 목록과 달력에서 기존 일정을 수정할 수 있다. 장소만 바꾸면 참석 응답을 유지하고, 시간 변경으로 다시 답해야 할 때는 저장 전에 안내한다. 일정 충돌은 겹친 시간과 사유 입력을 표시한다. 알림 준비에 실패해도 이미 저장된 일정은 성공으로 표시하고 알림 실패만 별도로 안내한다.
- 완료: 시스템 점검이 메일 발송 보류를 표시한다. 대본 등록 후 구성 반영을 재시도할 때 기존 대본을 다시 쓰도록 결과 계약을 복원했다.
- 검증: check·test·build 통과(Jest 89 suites/916 tests 및 Node 회귀). 격리된 DB와 실제 브라우저에서 일정 생성·수정, 배우 재응답, 390px 저장, 시스템 점검의 발송 보류를 확인했다. 기본 개발 DB는 연결 시간 초과였고 외부 메일 실수신은 B-109로 남는다.

14차 — 프론트·어드민 문구 자연어 정리(2026-11-11, 완료). B-114. 시작 snapshot `2fd93afeecc40c233bc1a3fc946bdd3a49702467`.

### B-114 [med] 사용자·관리자 화면의 문체와 안내 문구 통일
- 완료: `/app`·`/admin`과 공통 대본·연습·첨부 컴포넌트, 공개 문의·약관·게스트 화면의 `~니다`체와 딱딱한 명령형을 자연스러운 `~해요`체로 정리했다. `알려주세요`·`붙여넣으세요` 같은 붙여쓰기도 바로잡고, 확인창·빈 상태·오류·저장 안내의 의미와 기능은 유지했다. 데모 대사의 인사말은 의도적으로 유지했다.
- 검증: frontend 56개 파일과 해당 회귀 기대값 1건을 수정했다. `npm run check` PASS(Svelte 0/0), `npm run test` PASS(87 suites/905 tests+Node 회귀 전체). 실제 Chrome 공개 6화면(`/`, `/support`, `/inquiries/new`, `/inquiries/lookup`, `/faq`, `/login`)에서 문구를 확인했다. 최종 API `/health/ready`·웹 200. backend 기능·schema/migration·환경·운영 배포·커밋·push 변경 없음.

13차 — 실제 관리자 이미지 등록·목록·수정 및 오픈 준비 후속(2026-10-24, 완료). B-113·B-103. 시작 snapshot `a6eba5a948d299f480d100b228c65aed44491f26`, 최종 검사 tree `b8eb84ac2673282a6604c7f99fe08252d3e53708`. 기존 미커밋 변경을 보존했고 운영 배포·환경·schema/migration·외부 메일·커밋·push 변경은 없다.

실제 Chrome+개발 DB+private R2에서 관리자 전체 흐름13/13·pageerror0, QA 이미지5개·공연 콘텐츠 정리 완료. 전용 관리자 BLOCKED/암호 교체/세션0·기존 로그인/token401. 비활성화 증거로 새 QA 계정1개·전용 org1개만 남기고 나머지12모델 count는 기준선과 동일하다. 초기 harness는 BrowserServer 종료 promise5초 초과로 전체FAIL이었다. 원본 증거를 보존하고 별도 종료 진단·사후 QA process 부재를 확인했으며 최종 판정은 `PASS_WITH_HARNESS_SHUTDOWN_LIMITATION`이다. 앱 기능 실패나 실제 원인 확정으로 해석하지 않는다.

최종 check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node223건)·build PASS. 실제 env 없는 snapshot·설치 deps 재사용·공유 Prisma92파일 불변·application619파일 일치. B-103 신규 회귀19/19·독립 리뷰 새 P1/P2 없음. `artifacts/cycle13-admin-journey/{REPORT,FINAL-VERIFICATION,CODE-REVIEW}.md`·품질/QA JSON 참고. B-109는 운영 검토 자료만 준비하고 TODO로 유지한다.

### B-113 [high] 실제 관리자 공연 등록·이미지·목록·수정 연결 검증
- 완료: 전용 SUPER_ADMIN의 실제 로그인→공연 등록 폼→포스터 선택/사진 drag→선택 쓰기0→등록1회/이미지3개 저장→목록 포스터·장소·준비 작업6개→새로고침/새 로그인→공연 이름/장소와 관객용 소개 별도 수정→포스터/사진2개 추가 저장→수정 목록·390px 카드·재로그인 열람을 확인했다. mocking0, 공개 소개404·익명 Asset401.
- 정리: 정확한 QA 객체5개 삭제/HEAD404·QA 콘텐츠 잔존0·메일0. 새 관리자만 BLOCKED·암호 교체·세션0으로 종료하고 기존 계정은 변경하지 않았다. 기본정보와 관객용 소개 제목·장소가 별도라는 화면 정의를 대조했다.
- 한계: 기능13/13과 데이터 정리는 통과했다. 최초 BrowserServer 종료 event/PID는 기록되지 않아 정확한 exitCode·지연 원인은 복구하지 못했다. 별도 빈 BrowserServer 진단은 exitCode0·종료 event/PID 부재/endpoint 차단 PASS, 사후 실제 QA process 잔존0. 불필요한 DB/R2 재실행은 하지 않았다.

### B-103 [med][운영 도구] 공연 일괄 등록 도구의 오류 출력 최소화
- 원인: HTTP/AI 실패 원문·임의 error.message와 성공 시 제목/파일명/응답 객체가 terminal로 전달될 수 있었고 env/state 파싱은 catch 바깥이었다. 실제 자료 유출을 확인한 것은 아니다.
- 완료: import 부작용 없는 실행 함수와 직접 실행 guard, env/state/HTTP/AI/파일을 포함한 공통 catch, 고정 code·stage·유효 status 및 집계만 출력한다. 기존 요청 순서·완료 skip·실패 상태 보존, 기존/새 상태 파일0600. 실행 담당자가 재시도 동안만 초안을 관리하고 완료/폐기 뒤 정리하도록 DEVELOPMENT에 기록했다.
- 검증: 임시 root의 합성 env/대본/미디어·mock fetch로19/19, sentinel 출력0·실패 body 미소비·요청/skip·완료 상태 보존·token 비저장·0600·복사 CLI stdout/stderr 경계를 확인했다. 실제 일괄 등록 CLI·AI 공급자·기존 로컬 초안 파일은 실행·삭제하지 않았다.

12차 — 공연 이미지 미리보기·드래그 등록·저장 시 업로드(2026-10-24, 완료). B-112. 시작 snapshot `7ffd0ac6d8ff90b10925f54f0492b731ac12ea34`, 최종 검사 tree `4a777b99e84d9302610290cc947f94fdedc6baf3`. 기존 미커밋 변경을 보존했다. backend·schema·migration·환경·의존성·운영 배포·커밋·push 변경은 없다.

최종 check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node 회귀204건)·build PASS. 합성 API 실제 Chrome11/11·개발 DB/R2 실제 Chrome6/6, pageerror0. 선택·드래그 단계 assets/R2 요청0, 저장 후 hash/HEAD·재로그인 열람·교체·비공개 경계를 확인했다. 관리자 신규 등록은 합성 API로, 실제 R2는 일반 PRODUCER의 공통 소개 편집 경로로 검증했다. QA 객체4개 삭제·행 잔존0·기존11모델 count 동일·메일0. 실제 env 없는 snapshot·설치 deps 재사용·공유 Prisma92파일 불변·application618파일 일치. `artifacts/cycle12-image-staging/{REPORT,BROWSER-QA}.md`와 JSON·로그 참고.

### B-112 [high] 공연 이미지 로컬 미리보기·드래그 등록·저장 시 일괄 업로드
- 요청: 관리자 공연 등록과 공연 소개 편집에서 파일 선택·드래그 즉시 브라우저 미리보기, 글 등록/초안 저장 시 선택 이미지를 함께 R2에 저장한다.
- 완료: 포스터1장·홍보 사진8장, PNG/JPEG/WebP 각10MB 이하. 선택·제거·취소는 로컬에서 처리하고 저장할 때 참조된 이미지만 업로드한 후 초안에 연결한다. 부분 실패 시 공연 ID·완료 파일·입력을 보존해 재시도하며 초안 저장과 공개 게시를 구분한다.
- 경계: 같은 session/공연에 요청을 결합하고 계정·화면 변경 시 지연 응답을 차단한다. 교체·제거·취소·화면 해제에서 object URL을 해제한다. R2와 DB는 별도 저장이므로 중간 실패가 전체 rollback을 뜻하지 않는다. 재시도 상태는 현재 페이지 메모리에 보관한다.
- 검증: 새 회귀17건·기존 보안 회귀19건 PASS, 독립 리뷰 미해결 P1/P2 없음·공식 Svelte autofixer issues0. 기존 checksum 대기 중 계정 변경 검사는 새 저장 경계로 옮기고 API0·초안 불변 assertion을 보존했다. 초기 QA fixture 오류는 최종 성공 결과와 분리해 기록했다.

11차 — R2 앱 키 교체·`art-bridge/` 저장 경로(2026-10-24, 완료). 시작 snapshot `ccd3848eda2fba63ae30adee93e31715c0b15ca6`, 최종 검사 tree `71da98380992f9c453cdc2722ea770aa2e8c79d4`. 사용자가 키 교체·개발 파일 검증과 기존 키가 프로젝트 전용임을 확인했다. 새 버킷 전용 키를 backend/.env에 반영하고 개발 서버를 재기동했으며 기존 키를 폐기했다. 운영 배포·DB migration·외부 메일·커밋·push는 없다.

최종 check PASS(Svelte0/0)·test PASS(87 suites/905 tests+Node 회귀187건)·build PASS. 실제 R2 PUT/HEAD/GET/Range·다른 버킷403, 기존 키401 Unauthorized·관리 조회404/새 키200 확인. Chrome 실제 앱 검증은 폐기 전·후 각각11/11, pageerror0·QA 객체/행 잔존0·기존 DB count 동일. 실제 환경 없는 snapshot에서 설치 deps를 재사용했고 공유 Prisma92파일 불변, source615파일 일치. `artifacts/cycle11-r2/REPORT.md`와 JSON·로그 참고.

### B-76 [high] QA 오류 출력에 포함된 R2 키 교체
- 원인: 6차 QA fixture 오류가 설정 객체의 R2 키를 tool 반환에 포함했다. 값은 문서·artifacts에 기록하지 않는다.
- 처리: 사용자 확인 후 `attachment` 버킷 Object Read & Write만 가진 앱 키를 발급·설치했다. 기존 앱 전용 키는 Cloudflare DELETE200 뒤 실제 S3 401 Unauthorized·관리 GET404를 새 키200과 대조했다. root 관리 키는 변경하지 않았다.
- 완료 조건 확인: 폐기 전후 실제 앱 파일 첨부·재사용·재열람 PASS, 새 키의 타 버킷403, 임시 자격 증명 사본 제거·backend/.env0600·비밀값 미스테이징. 초기403 한정 판정은401도 인증 거부로 확인해 기록했으며 키를 재폐기하지 않았다.

### B-110 [high] R2 저장 경로를 art-bridge로 변경하며 기존 파일 접근 유지
- 수정: 신규 파일은 `attachment/art-bridge/`에 저장하고 `R2_LEGACY_PROJECT_NAMES=reading-musical`로 같은 버킷·prefix의 이전 파일을 읽는다. 이전 객체26개의 개수와 DB storageKey를 유지했고 실제 사용자 파일 본문은 열지 않았다.
- 완료 조건 확인: 목적 폴더·프로젝트 경계·local fallback·잘못된 설정 거부 회귀 PASS. 신규 업로드와 합성 legacy 파일 재사용·hash·Range206를 실제 Chrome에서 확인했다. 임의 경로·wildcard·다른 프로젝트 허용은 추가하지 않았다.

### B-111 [high] 참고파일 첨부 후 화면 재생성 시 업로드 잠금 해제
- 원인: workspace의 revision/resetKey 변경이 Attachments를 해제하면 자식 finally의 disposed guard가 부모에 bind된 transferring 해제를 건너뛰었다.
- 수정: 현재 workspace/session이 첨부 저장을 끝낼 때 공유 전송 상태를 해제한다. 기존 계정·공연·dispose guard와 실패 시 입력 보존은 유지했다.
- 완료 조건 확인: 성공·실패·재조회 실패·동일 owner refresh·계정 전환·다른 draft 회귀 추가. 기존 구현 대조 시 새 회귀3건 실패 확인, 수정 후 Node19/19·공식 Svelte autofixer issues0. 실제 첨부 직후 버튼 활성화·재사용·탭 이동·새로고침·fresh context 재열람 PASS.

10차 — 신규 가입 이메일 인증(2026-10-23, 완료). 사용자 결정 B-102와 구현 B-104~B-108 완료. 시작 snapshot `682fda15c604e29d6a085ba36f2f1accd20051e3`, 최종 application tree `328cefbb649cef83f15bd29d6de703038f98b05c`. 기존 미커밋 작업을 보존하고 사용자 승인 후 분리 개발 DB에 신규 테이블 하나만 적용했다. 운영 배포·메일 발송·커밋·push는 하지 않았다.

최종 check PASS(Svelte0/0)·test PASS(87 suites/880 tests+Node 회귀182건)·build PASS. 실제 개발 PostgreSQL50/50(가입/복구/실제2연결경합35+파기SQL15), 합성 API 실제 브라우저16/16·계약검사73건 PASS. 초기 DOM pattern 오류를 수정하고 전체 gate·브라우저를 다시 검증했다. QA 잔존0·기존 데이터 count 불변·외부메일0. 정상 launcher 재기동 후 API ready/웹200·익명401·필수입력422 확인. 실제 정책은 미게시·signupReady=false이며, 실수신/예약작업은 B-109로 남긴다. `artifacts/cycle10-email-verification/{REPORT,CODE-REVIEW,DB-INTEGRATION,browser-verification}.md` 참고.

### B-104 [high] 계정 생성 전 이메일 확인과 일회성 가입 증명
- 수정: 별도 challenge 테이블 하나에 목적별 HMAC 인증번호·시도 횟수·만료·가입 proof hash를 저장한다. 발급/메일 outbox와 최종 proof 소비/동의/회원 생성을 각각 transaction으로 묶는다.
- 완료 조건: 인증 전 계정/token 없음, 재전송·시도 제한·만료·다른 이메일·재사용·동시 소비 차단, 잘못된 시도 commit·가입 실패 rollback. 기존 User 상태와 로그인 조건을 변경하지 않는다.

### B-105 [high] 가입 화면 이메일 인증·재전송·초대 복구
- 수정: 인증번호 받기→확인→가입 흐름, 이메일 수정/만료 시 재인증, 폼 입력·현재 약관 동의 유지. 인증 후 기존 초대 수락을 연결하고 수락만 실패하면 이미 생성한 계정으로 초대를 재시도한다.
- 완료 조건: 인증 전 가입 차단, 이메일·계정 전환·unmount 뒤 지연 응답 무시, 코드/proof/비밀번호 URL·브라우저 저장소 비저장, 오류·재전송·모바일 화면 확인.

### B-106 [high] 기존 회원·초대·복구 호환성 검증
- 수정·완료 조건: 기존 ACTIVE 로그인/refresh/암호 복구와 차단 계정 거절, refresh 재사용·reset purpose/fingerprint·세션 철회를 실제 service 회귀로 검증한다. 기존 초대 권한·transaction 검사를 유지하며 새 인증 증명이 다른 token을 대신하지 못하게 한다.

### B-107 [high] 인증 메일 발송 직전 유효성·본문 정리
- 수정: 신규 가입 인증 메일도 현재 challenge와 수신자를 재검사하고 만료·확인·소비·재발급된 코드는 발송하지 않는다. 완료·말단 실패·worker 중단의 말단 복구에서 인증번호 원문을 제거한다.
- 완료 조건: 메일 보류 시 challenge/outbox write0, mock provider로 코드 수명·재시도·일반 메일/기존 상담 인증 동작 보존. 실제 발송은 별도 승인된 수신자에서 확인한다.

### B-108 [med] 미가입 이메일 인증 기록·만료 코드의 별도 파기
- 근거: 인증번호 만료와 미가입 이메일/코드 원문 정리는 별개이며 메일 worker 보류 중에도 정리할 경로가 필요하다.
- 수정·완료 조건: 시간당 발급 제한을 보존하며 24시간 이전·코드/proof 만료 challenge를 제한된 batch로 삭제한다. 10분이 지난 가입 인증 메일 본문을 정리하고 QUEUED만 종료하며 PROCESSING의 lease·상태·시도를 보존한다. 가입 인증 메일 기록도 24시간 뒤 삭제하고 처리 중인 행은 수신자·metadata 등 개인정보를 익명화한다. 보류와 독립적인 별도 명령·집계·반복 배치 회귀를 제공한다. 실제 예약 등록·파기 실행은 운영 준비 단계로 구분한다.

### B-102 [high][오픈 정책 결정] 신규 가입 이메일 소유 확인 범위
- 근거: 기존 `AuthService.register`는 필수 동의 확인 후 ACTIVE 계정과 token을 즉시 생성하며 이메일 소유 확인을 하지 않았다. 공연 상담 조회 인증과 다른 경로다.
- 결정: 사용자가 신규 가입 이메일 인증 도입을 선택했다. 기존 회원은 소급 차단하지 않고 초대 신규 가입도 이메일 확인을 거친다. B-104~B-107에서 구현·검증한다.
- 완료 조건: 코드·회귀·화면 검증과 DB 적용/실제 메일/운영 미검증 경계를 기록한다. 법적 필수라는 판정이나 운영 적용 완료로 표현하지 않는다.

9차 — README·정식 오픈 준비(2026-10-23, 완료). 시작 snapshot `befbddcdeddaed71f2498b8c13c5eb0595bc8efe`. B-99~B-101 완료. 기존 미커밋 코드를 보존하고 문서와 CI 준비만 정리했다. 운영 설정·DB·키·약관 게시·메일 발송·배포·커밋·push는 실행하지 않았다.

별도 snapshot 폴더에서 check PASS(Svelte0/0)·test PASS(83 suites/785 tests+회귀)·build PASS. 실제 환경 파일 없이 설치된 deps를 재사용했고 공유 Prisma92파일·runtime은 유지했다. fresh npm ci·실제 GitHub CI·운영 검증은 아니다. 문서 링크·npm 명령·workflow 구문 검사 PASS. `artifacts/launch-preparation/{REPORT,RELEASE-AUDIT,PRIVACY-OPERATIONS-AUDIT,SNAPSHOT-QUALITY}.md` 참고. 공개 가입 정책 B-102·도구 오류 출력 B-103·키 교체 B-76은 TODO로 남긴다.

### B-99 [med] README·개발·운영 문서의 현재 상태 정리
- 근거: README에 모집·지원·공개 공연 소개가 빠졌고 9월의 검증 실패가 현재 안내와 섞여 있다. 운영 문서는 10월11일 구현 중간 기록과 현재 절차를 함께 보여 준다.
- 완료: 현재 화면·역할·실행 명령·문서 지도를 정리했다. 과거 이력과 최신 로컬 검증, 미구현 화면·운영 미검증을 분리하고 주요 안내는 저장소에 포함된 파일로 연결했다.

### B-100 [high] CI의 전체 품질 게이트 누락
- 근거: `.github/workflows/ci.yml`은 tests가 미포함이라는 옛 주석과 compile 단계만 두고 Jest·계정/미디어 경계 회귀를 실행하지 않았다.
- 완료: CI 임시 PostgreSQL migration을 유지하고 canonical check/test/build를 연결했다. YAML 구문·명령·snapshot 검사 파일 포함 여부와 별도 snapshot gate를 검증했다. 실제 GitHub 실행은 후보 commit·push 후 확인한다.

### B-101 [high] 정식 오픈 준비와 실제 공개 조건 구분
- 근거: 로컬 기능·리팩토링 검증은 완료됐지만 B-76 키 교체와 운영 revision·DB 복구·저장소·메일·정책·실물 기기 검증은 오픈 증거가 없다.
- 완료: 저장소 공통 `LAUNCH_READINESS.md`에 준비 순서·오픈 범위·필수 증거·중단 기준·복구·관측 항목을 정리했다. 미확인 운영 상태는 유지하며 실제 공개 조건과 준비 문서 완료를 구분했다.

8차 사이클 — 최종 화면·권한 감사 후 동작 보존 리팩토링(2026-10-23, 완료). 시작 snapshot `4671c00ab1d6f6337fa779718285bf205abee177`. 기존 미커밋 변경을 보존했다. schema·환경·운영 설정·의존성·커밋·push 변경은 없다.

최종 check PASS(Svelte 오류·경고0), test PASS(83 suites/785 tests+기존 회귀·신규 Client/미디어/화면56건), build PASS. API 경계327파일 PASS, 실제 PostgreSQL23/23·생성21행 rollback/잔존0, 재기동 뒤 합성 API 브라우저9/9(pageerror0·모바일 overflow0), API ready/웹200·익명 보호 API401 확인. `artifacts/cycle8-refactor/{REPORT,CODE-REVIEW}.md`와 최종 로그 참고. 기존 테스트의 assertion·시나리오는 유지했고 새 의존성/중앙 Client 경로를 실행기에 연결했다. B-76 운영 후속은 TODO로 남긴다.

### B-86 [med] 최종 기능·화면 정의 대조
- 근거: PRD의 legacy 경로·향후 화면 표시가 실제 `/app/*`, `/performances/*`, 모집 4화면과 다르다.
- 수정·완료 조건: 실제 route·역할·쓰기 권한·공개 범위와 미구현을 구분한 화면 정의 및 PRD 갱신.

### B-87 [high] 로그인 소유자 변경 시 응답·캐시·개인 초안 격리
- 근거: A의 늦은 refresh가 B 로그인 토큰을 덮고, 다른 탭 계정 전환 후 A 개인 연습 기록을 B에게 저장할 수 있다. owner 없는 SWR는 이전 관리자 정보를 먼저 표시한다.
- 수정·완료 조건: session owner/epoch로 refresh·재시도·응답·캐시를 제한하고 계정 전환 시 보호 화면·초안을 폐기한다. 동일 계정 refresh는 초안을 보존한다. 지연 응답·로그아웃·두 탭 회귀.
- 독립 리뷰 보완: refresh 응답의 계정 일치, 프로필 checksum·사진·개인정보 저장, 공연 미디어 배치·첨부·큐·CSV 가져오기의 전체 async chain을 시작 세션에 묶는다. 이전 layout의 늦은 redirect와 source 변경 후 저장 잠금도 회귀로 검증한다.

### B-88 [high] 개인 대본 주석은 작성자만 조회
- 근거: 제작자·연출의 canSeeAll 분기로 다른 사람의 `isShared:false` 주석이 노출된다.
- 수정·완료 조건: getScript/listAnnotations 모두 본인 또는 공유 주석만 반환한다. 버전 snapshot 비공개 경계를 유지하고 역할별 회귀 추가.

### B-89 [high] 중첩 연락처와 공연팀 프로필 최소 공개
- 근거: 일정·run-sheet·리딩 응답 중첩 user.email 마스킹이 빠졌고 listPeople이 임의 profileDetails와 타인 참석 이력을 일반 참여자에게 반환한다.
- 수정·완료 조건: 응답 interceptor로 이메일 마스킹, 명시적인 프로필 projection·민감 정보 권한 적용. 메일 발송용 원본 조회·권한 있는 연락처 경로 보존 및 회귀.

### B-90 [med] 리딩의 삭제 대본 장면 제외
- 근거: 리딩/게스트 workspace와 장면 연결 검증이 삭제 대본을 포함한다.
- 수정·완료 조건: 조회·연결 모두 `script.deletedAt:null` 필터, 삭제/복원 회귀.

### B-91 [med] 현재 프로필 사진·유효한 공동 공연만 이미지 공유
- 근거: 사진 해제·교체 후와 공동 공연 삭제 후에도 예전 개인 IMAGE의 접근이 남는다.
- 수정·완료 조건: 현재 photoAssetId와 삭제되지 않은 공동 공연을 확인한다. 소유자·운영자·기존 보관 정책을 보존하고 교체·해제·삭제 회귀.

### B-92 [high] 리딩 socket 전송 시 현재 접근 권한 재검증
- 근거: room 참가 뒤 멤버·출석 제거/차단에도 기존 socket으로 내부 progressNote가 전달될 수 있다.
- 수정·완료 조건: 보호 이벤트 전달 경계에서 사용자·공연·멤버십/출석을 재검증하고 무효 room 구독을 철회한다. 유효 수신·게스트 만료·철회 동작 및 회귀 보존.

### B-93 [med] 기획 메모의 조직별 수정 권한
- 근거: 타 조직 ORG_ADMIN이 공연 역할로 들어온 뒤 전역 admin 분기로 타인 메모를 수정·삭제한다.
- 수정·완료 조건: 작성자 또는 해당 공연 관리자만 변경, foreign/own-org/SUPER 역할 회귀.

### B-94 [med] 기능별 권한과 현재 팀 연결 상태 표시
- 근거: canManageTracks가 설정·멤버·캐스팅 버튼까지 열어 서버403과 어긋난다. 관리자 승인 이력이 멤버 제외 후에도 연결 완료로 보인다.
- 수정·완료 조건: 서버의 기능별 capability와 UI 일치, membershipId 없는 승인 이력 구분. 기존 서버 권한을 넓히지 않고 역할별 회귀.
- 보완: 보관 공연의 기존 열람·일정 권한을 유지한다. 기타 스태프 직무는 이름 입력을 받고 기존 customLabel·isLead를 보존하며, 검증 실패 시 역할만 먼저 저장하지 않는다.

### B-95 [med] 공연 준비 현황의 순수 계산 분리
- 수정·완료 조건: DB 조회·접근 검증은 service, 집계는 pure builder로 분리한다. 빈 자료·대본 유형·멤버·큐시트·체크리스트 상태별 결과와 기존 동작 보존.

### B-96 [med] 모집 문서 검증·응답 Presenter 분리
- 수정·완료 조건: 문서 정규화·검증과 응답 계산을 순수 모듈로 분리한다. 트랜잭션·lock·승인·이력·권한은 service에 유지한다. 경계 시간·날짜·정규화·whitelist 회귀.

### B-97 [med] 공연 소개 문서 정책 분리
- 수정·완료 조건: 텍스트·날짜·URL·갤러리 검증을 순수 모듈로 분리한다. 공개 snapshot·사진 IO·HMAC·동의·재확인 경계 보존, 잘못된 URL/날짜·중복 이미지·입력 whitelist 회귀.

### B-98 [low] 실무형 주석과 모듈 경계 정리
- 수정·완료 조건: 수정한 코드의 주석은 JSDoc/TSDoc 또는 일반 주석으로 의도·불변 조건·개인정보 경계를 간결하게 기록한다. 존대·변경 이력·코드 반복 설명을 피하고 UI 문구와 섞지 않는다. 불필요한 추상 계층·의존성을 추가하지 않는다.


7차 사이클 — 모집·지원·승인 (2026-10-23, 완료). B-77~B-85. 시작 snapshot `13683d713022eaa2e609cae6e04b8517fe9ac265`. 조직·기본 활동 직군에 관계없이 지원하고 승인 시 ACTOR/STAFF만 공연팀에 추가해요. 기존 5·6차 미커밋 변경·대표 역할·다른 역할·조직·전역 권한·배역·직무·공개 동의를 보존했어요. 신규 의존성·커밋·push·운영 배포는 없어요.

사용자 명시 승인 후 신규 4테이블 migration 하나만 분리 개발 DB에 적용했어요. 최종 B85 보완 뒤 check PASS(Svelte0/0)·test PASS(70 suites/658 tests+기존 회귀)·build PASS, 실제 PostgreSQL11/11·자기 공연정리3/3·브라우저기능19/19·after12/12 PASS. 신규 QA8개는 암호 hash 교체/BLOCKED/세션0/이전 암호·token401, 기존 전용 관리자 BLOCKED/세션0/API·브라우저401로 정리했어요. 브라우저 QA 모집7개 CANCELLED·미처리0·승인멤버 보존, 공개소개0·메일0. `artifacts/cycle7-recruitment/{REPORT,DB-INTEGRATION,BROWSER-REPORT,INDEX}.md`·최종 gate 로그 참고.

### B-77 [high] 회원 공개 모집과 지원 상태·저장 구조
- 위치: 신규 `BE/recruitment/*`, Prisma schema·additive migration
- 문제: 초대·직접 배정만 가능해 다른 조직 배우·스태프가 공연을 찾아 지원할 수 없어요.
- 수정: 회원에게 게시한 모집만 공개하고 초안·모집·마감·취소를 구분해요. 회차별 한 지원과 접수/검토/추가 검토/확정/미선정/취소 이력을 관리해요. 이메일·개인 일정·내부 자료를 모집 응답에 포함하지 않아요. 게시 후 조건은 고정해요.
- 완료 조건: DTO·scope·whitelist·revision·마감·철회/재지원 테스트, 검토 가능한 SQL과 개발 DB 적용 승인.

### B-78 [high] 승인 시 안전한 공연팀 연결과 조직별 권한
- 위치: 신규 모집 transaction, `BE/common/guards/roles.guard.ts`, `BE/productions/productions.service.ts`
- 수정: 정원을 확인하며 신청 ACTOR/STAFF만 기존 역할에 추가해요. primaryRole·조직·전역 권한·다른 공연·공개 동의는 보존해요. 타 조직 ORG_ADMIN도 배정받은 역할로 참여하되 해당 공연 관리 권한은 받지 않아요. 마감·취소·공연 보관/삭제와 승인 경합을 직렬화해요.
- 완료 조건: 중복 승인 멱등·마지막 정원 경합·철회/취소 경합·역할/조직 보존·승인 전 내부 접근 차단.

### B-79 [high] 배우·스태프 모집 탐색과 내 지원 현황
- 위치: 신규 `FE/lib/api/recruitment.ts`, `domain/recruitment.ts`, `/app/opportunities`·상세·`/app/applications`
- 수정: 모집 분야·인원·지역·참여 기간·조건·마감을 확인하고 짧은 지원서를 보내요. 지원 상태와 공연팀의 답변·이력을 확인하고 미처리 지원은 취소해요. 같은 회차 미선정은 재지원하지 않으며 취소 후 접수 중에는 재지원해요.
- 완료 조건: 입력 보존·409 복구·빈/오류 구분·목록 페이지 이동·desktop/mobile/dark·실제 접수/철회/결과.

### B-80 [high] 관리자 모집 작성·게시·지원 검토
- 위치: 신규 `/app/p/[pid]/manage/recruitment`, 공연 카드·설정·공연별 메뉴
- 수정: 배우·스태프 자리와 조건을 작성·검토한 뒤 게시해요. 지원별 검토/추가 검토/참여 확정/미선정과 지원자에게 전할 말을 기록해요. 마감·모집 취소는 확인창 뒤 처리하고 확정 멤버는 유지해요.
- 완료 조건: 공연별 권한·초안 수정/게시 후 고정·정원 표시·상태 색+문구·실제 승인과 배역/직무 관리 이동.

### B-81 [med] 내 일정·참여 공연 우선 홈과 알림
- 위치: `FE/routes/app/+page.svelte`, `app/+layout.svelte`, 알림 formatter
- 수정: 로그인 후 내 일정→참여 공연을 유지하고 모집 찾기·내 지원 진입을 제공해요. 접수/결과 인앱 알림과 확정 공연 링크를 연결해요. 전역 조직 관리자도 해당 공연의 실제 일정 수정 권한만 표시해요. 중복 안내와 과장된 문구를 넣지 않아요.
- 완료 조건: 배우/스태프 홈 순서·승인 직후 내 공연·배정 일정만 내 일정 노출·모바일 4개 하단 메뉴 유지·지원 상태 알림.

### B-82 [high] 타 조직 참여자의 서비스 내부 권한 상승 방지
- 근거: 조직별 RolesGuard를 참여 역할로 fallback하면 checklist·run-sheets의 전역 isPlatformAdmin 분기가 타 조직 ACTOR/STAFF에게도 담당자 외 변경·승인을 허용해요.
- 위치: `BE/checklist`·`BE/run-sheets` 및 같은 guard fallback으로 직접 영향을 받는 music/reading 권한 헬퍼
- 수정: 서버에서도 해당 공연의 조직 관리자 여부와 배정 역할·직무를 확인해요. 같은 조직 운영 권한은 유지하고 다른 조직에서는 승인된 역할만 사용해요.
- 완료 조건: foreign ORG_ADMIN ACTOR/STAFF가 담당 외 변경·승인과 직무 검사를 우회할 수 없고 실제 PRODUCER·자기 조직 운영 권한은 유지되는 회귀 테스트.

### B-83 [med] 기획 리뷰에서 확인한 재지원·모바일·승인 이력 보완
- 위치: `FE/routes/app/opportunities/[id]`, `/app/applications`, `/app/p/[pid]/manage/recruitment`
- 근거: 취소 후 지원 자격 목록을 재조회하지 않으면 재지원 폼이 숨겨져요. 모바일 회차 목록 뒤 상세 변화가 묻히고, 승인된 멤버가 나중에 제외돼도 참여 중 안내가 남아요.
- 수정: 지원 취소 후 서버 자격 목록 재확인, 명시적 회차·새 모집 선택에만 상세 heading 이동, 현재 membership 연결과 승인 이력을 구분해요.
- 완료 조건: 입력 보존하며 취소→재지원, 모바일 새 모집 진입, 멤버 제외 후 잘못된 공연 열기 링크 없음.

### B-84 [med] 신규 QA 임시 암호 출력 후 검증 계정 정리
- 근거: 7차 검증 담당자가 신규 fixture 원문 일부를 읽으며 이 사이클 일반 QA 계정의 공유 임시 암호를 tool output에 포함했어요. 실사용·기존 계정의 암호는 아니며 값은 문서에 저장하지 않아요. 사용자에게 알렸어요.
- 조치: 비밀 아닌 ID/역할만 선택 조회하도록 수정했어요. 검증 후 이번에 생성한 QA 8계정만 ID·prefix·이름·일반 등급을 확인해 BLOCKED/세션 철회/무작위 비밀번호 hash 교체하고, 이전 암호·token401과 artifacts의 암호 제거를 확인해요.
- 완료 조건: 기존 계정의 암호는 그대로, 신규 QA8개 비활성화·세션0·이전 인증 실패·원문 재출력 없음. 완료: 신규 QA8개 BLOCKED·세션0·무작위 hash 교체·이전 token8/8/암호8/8 401·fixture 암호 제거. 기존 계정 암호는 바꾸지 않았어요.

### B-85 [med] 지원 취소 대기 중 숨는 실패 안내와 중복 접수 문구
- 근거: 실제 브라우저에서 지원 취소 요청을 지연503으로 주입하면 Escape에는 유지됐지만 외부 클릭 시 dialog가 닫혀 실패 안내가 숨고 실제 지원은 SUBMITTED로 남았어요. 접수 성공 문구도 banner와 상태 카드에 그대로 반복돼요.
- 위치: `FE/lib/components/recruitment/WithdrawApplicationDialog.svelte`, 모집 상세 지원 성공 처리
- 수정: 처리 중 Escape·외부 닫힘을 실제 Dialog 이벤트에서 막고 실패 후 오류를 보이게 유지해요. 처리하지 않을 때 닫기는 보존해요. 접수 성공 안내는 새 상태 카드 한 곳으로 정리해요.
- 완료 조건: 주입 지연/실패 중 Escape·바깥 클릭에도 오류와 상태 확인이 가능하고 실제 지원은 미변경, 접수 안내 중복 없음·Svelte check/autofixer·해당 브라우저 회귀.
- 수정·재검증: busy 동안 Dialog 이벤트의 기본 닫힘을 막고 접수 성공 중복 설정 1줄을 제거했어요. 공식 autofixer issues0·frontend check0/0. 실제 브라우저에서 Escape/외부 클릭/503 후 dialog·오류 유지, DB의 지원 상태·revision 불변을 확인했어요.


6차 사이클 — 운영 대시보드·공연 소개 (2026-10-23 사용자 요청, 완료). 시작 snapshot `db25acbf1292d78d0020b044bb0075239d93ffa0`. 기획 에이전트와 화면/API/schema를 검토했어요. 5차 미커밋 작업을 보존하며 커밋·push·운영 배포는 하지 않아요. 사용자 승인 후 분리 개발 DB에 신규 두 테이블 migration 하나만 적용했어요. 실제 PostgreSQL8개, 브라우저 운영12·편집7·동의6·공개10·권한3·포스터4·hash4·저장스크롤1·실제정렬1과 after16화면 PASS(기능48/48). QA 소개4개를 내리고 배우 동의false·원래 사진복구, 전용관리자 BLOCKED/세션0/이전token·API·브라우저401을 확인했어요.

### B-71 [high] 실제 수치를 보여 주는 운영 대시보드
- 위치: `FE/routes/admin/+page.svelte`, 신규 `admin/operations-chart.svelte`, `domain/operations-dashboard.ts`
- 문제: 운영 첫 화면에서 처리할 일과 공연별 자료 현황을 빠르게 비교하기 어려워요. 등록 유무의 단순 평균을 공연 완성도로 표시하면 오해할 수 있어요.
- 수정: 실수치 4개·현재 단계 분포(ECharts)·추가할 자료·공연별 등록 행렬·최근 문의. 그래프와 같은 HTML 수치, 모바일·dark·reduced motion·dispose를 제공해요.
- 완료 조건: API와 그래프 수치 일치, 미등록/해당 없음 구분, 임의 추세·완성도 없음, 화면 이동·resize·모바일 검증.

### B-72 [high] 포스터와 상태 버튼으로 공연 목록 정리
- 위치: `FE/routes/admin/productions/+page.svelte`, `BE/admin/admin-ops.service.ts`
- 문제: 작업 링크가 텍스트로 이어져 현재 등록 상태를 구별하기 어려워요.
- 수정: 포스터·장소·기간과 실제 대본/공연팀/배역/일정/큐 상태를 버튼으로 보여요. 색상뿐 아니라 아이콘·문구도 사용하고 미조회는 미등록으로 단정하지 않아요. 기존 등록 query·삭제·휴지통·기획 메모를 보존해요.
- 완료 조건: 등록/추가 필요/해당 없음/조회 실패·포스터 fallback·정확한 이동과 기존 cold 등록 회귀.

### B-73 [med] 공연 workspace 메뉴 범위
- 위치: `FE/routes/app/+layout.svelte`
- 수정: 공연 안에서는 해당 공연 작업·제작 관리 메뉴만 보여요. 도움말·개인정보·전체 운영은 메인에서 제공하고 목록 복귀·계정 메뉴는 유지해요.
- 완료 조건: 관리자/참여자의 공연 안과 메인에서 sidebar 범위 확인.

### B-74 [high] 홍보 초안·명시적 게시와 관객용 공연 소개
- 위치: 신규 `BE/showcase/*`, Prisma additive migration, assets purpose, `FE/lib/api/showcase.ts`, 공연 설정 편집기, `/performances`·상세·랜딩
- 수정: 운영 visibility와 별개로 홍보 초안/공개본을 저장해요. 공개 제목·설명·장소·날짜·포스터·홍보 사진8장·HTTPS 공식/예매/영상 링크를 입력하고 미리보기 뒤 명시적으로 게시해요. 초안 수정은 기존 공개본을 바꾸지 않아요. 목록·랜딩은 실제 게시한 공연만 보여요.
- 완료 조건: 권한·공연별 asset 소유권·동시 수정409·초안/공개본 분리·게시 전404·비공개/삭제/보관 즉시 제외·복구 후 자동 재게시 금지·미디어 no-store. DB 적용은 SQL 검토·사용자 승인 후 분리 개발 DB에서 완료했어요. 운영에는 적용하지 않았어요.

### B-75 [high] 출연진 이름·사진의 공연별 본인 공개 선택
- 위치: 신규 `PerformanceCreditConsent`, `BE/showcase/*`, 프로필 동의 widget·공개 상세
- 수정: ACTIVE 배우에게 배역과 멤버십이 있을 때 본인이 이름·사진을 각각 선택해요. 기본 미동의이며 관리자가 대신 동의하지 않아요. 공개 응답에서 현재 동의·배역·계정·멤버십을 매번 확인하고 프로필 사진 변경 시 사진을 재확인해요.
- 완료 조건: 이름/사진 별도 선택·철회·사진 교체·배정 해제·BLOCKED·공연 비공개 제외, 연락처/내부 자료 비노출·공개 사진 proxy 재검증. 전용 QA 관리자 최종 BLOCKED·세션0.


5차 사이클 — 역할별 사용 흐름·화면·문구 개선 (2026-10-23 사용자 요청, 완료). 변경 전 스냅샷 `9c4181604de61b5802a08019894d9c2264d7673a`. 기존 4차 공통 UI/Storybook을 재사용하고 backend·API·schema·운영 설정은 유지해요. 이번 요청에는 커밋 지시가 없으므로 미커밋 작업 트리로 남겼어요. push·운영 배포는 하지 않았어요.

검증: 최종 check/test/build PASS(Svelte0오류0경고, 61 suites/514 tests + 기존 회귀·새 reader7/checklist20). 기존 테스트 본문 수정 없음. Chrome 기능38/38·실제 역할별desktop/mobile6/6·등록cold2/2 PASS. before64/after68 캡처와 역할별6개 화면, `artifacts/ux-refresh/REPORT.md`·`INDEX.md`·최종gate로그로 확인해요. 전용 QA관리자 BLOCKED·활성세션0·기존토큰/API/브라우저로그인401. 개발 QAfixture만 보존했고 실물mobile·운영배포·실제가입/메일/약관공개는 검증 범위에 넣지 않았어요.

### B-64 [high] 서비스 소개와 로그인·가입의 구체적인 안내
- 위치: `FE/routes/+page.svelte`, 인증 화면, `landing/*`, `app/auth-shell.svelte`
- 문제: 공연 참여 약속과 기능 설명이 길고, 모바일 설치 안내가 서비스 진입을 막아요. 데모가 자동으로 넘어가 읽기 어려워요.
- 수정: 대본·반주·큐·일정을 공연별로 찾는 이점을 첫 화면에 보여요. 역할별 행동과 배정/초대 순서를 짧고 정확하게 안내하고 웹 진입·44px CTA·명시적 설치 선택을 제공해요. 초대·인증·동의 계약과 문의 기능은 유지해요.
- 완료: 공개·인증 desktop/mobile 렌더·진입·데모·초대 흐름 확인.

### B-65 [high] 내 공연·공연 홈의 오늘 할 일과 역할별 진입
- 위치: `FE/routes/app/+page.svelte`, `app/p/[pid]/+page.svelte`
- 문제: 다음 일정 응답이 공연 카드 뒤에 묻히고 모바일 불참 버튼이 잘려요. 공연 홈은 같은 비중의 CTA가 많고 응답 변경은 곧바로 반대로 바뀌어요.
- 수정: 다음 일정/미응답·이어 연습·배역/담당 정보의 우선순위를 세워요. 참석/불참/미정 명시 선택, 복수 역할 지원, 오류/빈 상태 구분·재시도와 다음 행동을 제공해요.
- 완료: 실제 역할별 home·응답·모바일 390px 넘침 없음.

### B-66 [high] 배우·스태프의 읽기·개인 연습 화면
- 위치: `FE/routes/app/p/[pid]/{script,live}/+page.svelte`, `rehearsal-record.svelte`
- 문제: 저장된 글자 크기가 없을 때 작은 크기가 적용되고 배역을 다시 골라야 해요. 모바일은 보조 설정·영상 때문에 대본이 아래로 밀려요.
- 수정: 기본 읽기 크기·배정 배역을 존중하고 대본/재생/내 대사·담당 큐를 먼저 보여요. 영상 접기와 보조 설정으로 좁은 화면을 정리해요. 시간 계산·미디어·MP4·개인 저장 계약은 유지해요.
- 완료: 읽기/연습 desktop/mobile·타임라인/내보내기 회귀. 최종 gate 재기동 후 ACTOR desktop/mobile print에서 새 main 여백0·본문 표시·shell 숨김 PASS(PDF 보존).

### B-67 [high] 관리자 공연 등록에서 대본·팀·일정까지 연결
- 위치: `FE/routes/admin/{+page,productions/+page}.svelte`, 구성 화면과 `composition-workspace`·`script-register`
- 문제: 공연 만들기가 목록만 열고 최근 문의/일정 링크가 잘못 연결돼요. 대본 등록 뒤 팀·일정 준비 경로가 끊겨요.
- 수정: 공연 기본정보 등록을 바로 열고 대본·자료→멤버·배역→일정→연습의 실제 링크를 제공해요. 선택 입력·다음 행동·초안 검토 안내를 명확히 하되 자동 완료율·없는 기능을 약속하지 않아요.
- 완료: 빈 공연 생성→대본 준비→팀/일정 이동, cold/SPA query 소비·재방문 비재열림·CTA 재열림·다른 query/hash 보존·긴 공연명 반응형 확인.

### B-68 [med] 회원·멤버·배역·공연 설정의 일관된 관리
- 위치: `FE/routes/app/p/[pid]/manage/*`, `admin/members/*`
- 문제: 역할 조사·방향 지시가 부자연스럽고 작은 해제 버튼·라벨 누락·재클릭 삭제 방식이 섞여 있어요.
- 수정: 회원 검색·초대·배역 배정의 행동을 분명히 하고 공통 확인창·44px 버튼·연결된 Label·오류/빈 상태를 적용해요. 기존 마스킹·권한·저장은 유지해요.
- 완료: 회원 검색·역할/배역 편집폼·삭제/배정 해제 취소·모바일 렌더와 기존 저장 API 계약 확인.

### B-69 [med] 일정·공연팀·게시판·프로필·알림의 현장 사용성
- 위치: 일정 두 화면, 공연팀·게시판, 프로필·알림 및 직접 관련 components
- 수정: 공통 제목/오류/빈 상태·직접적인 문구·담당자 찾기·명확한 공유 범위·확인창을 적용해요. 개인정보·개인 메모·API 계약은 유지해요.
- 완료: 알림 오류 복구, 팀 검색·일정·대화 흐름과 모바일 확인.

### B-70 [med] 공통 UI·역할별 메뉴·보조 관리 화면
- 위치: `app.css`, 사용자/관리자 shell, 공통 page/state/button, 운영·문의·도움말 화면
- 수정: 기존 무대 조명 계열 브랜드를 유지하며 버튼 대비·읽기 위계·모바일 터치 영역을 맞춰요. 배우는 대본/연습, 담당 스태프는 큐시트, 관리자는 준비 흐름을 먼저 보게 해요. 반복되는 시스템 말투는 짧고 행동 가능한 한국어로 바꿔요. 큐시트 삭제·초기화/트랙 삭제를 공통 확인창으로 맞추고, 체크리스트 저장 실패의 입력 보존·공연 전환 시 늦은 응답/재조회 반복을 막아요.
- 완료: 현재 역할 기반 메뉴·키보드·대비·주요 화면 desktop/mobile, 전체 check/test/build.

4차 사이클 — UI 표준화 (근거: `docs/reports/planner-review-2026-10-23.md` 3·4절, 보고서 5절 1번). 경로 앞 FE/ = `frontend/src/`. 순서: B-61·B-62 병렬 → B-63. 이번 사이클은 **표준 컴포넌트 신설과 시범 적용**까지이고, 화면 전수 치환은 다음 사이클이다. 동작·API·라우트는 바꾸지 않는다.

**상태 2026-10-23: B-61·B-62·B-63 구현·커밋 완료(`7a0363b`, `8683962`, `ae44860`).** 게이트: `npm run check` PASS, `npm run test` PASS(61 suites / 514 tests + 회귀 스크립트, confirm-dialog·ui-standard 포함). 지휘자 확인: `backend/src/site/admin-ui.spec.ts`가 옛 ConfirmAction 본문을 문자열로 검사해 실패 → ui/confirm-dialog 기준으로 수정. Storybook: 브라우저에서 스토리 46개 전수 렌더 확인(중첩 버튼·오류 화면 0건; "처음부터 열려 있어요(모바일)" 다이얼로그 스토리는 포털 렌더라 root가 비어 보이는 것이 정상). 스토리 본문이 meta `component`로 감싸이는 결함을 발견해 children 스토리 30개에 `asChild`를 붙여 수정. 5차에서 실제 앱의 중첩 확인창 취소·재열기, 회원명 h1 바깥 배지, 전체 build를 확인했어요. 주요 사용자/관리자 화면은 5차에서 공통 UI와 문구를 적용했으며, 모든 raw control을 같은 컴포넌트로 일괄 치환하는 구조 변경은 별도 리팩터 범위예요.

### B-61 [high] ConfirmDialog 승격 + Button `touch` 크기
- 위치: `FE/lib/components/admin/ConfirmAction.svelte`(bits-ui AlertDialog 직접 사용, admin 6개 화면: inquiries/[id], support, settings, faq, members/[id], productions), `FE/lib/components/ui/button/button.svelte`, `FE/routes/app/p/[pid]/checklist/+page.svelte:70,97`(`window.prompt` 2곳)
- 결함: 삭제 확인이 화면마다 `window.confirm`(28곳)·`window.prompt`(2곳)·admin 전용 컴포넌트로 흩어져 있고, 사유 입력이 필요한 흐름은 prompt라 모바일에서 투박하고 빈 값/취소 구분이 안 된다. Button `sm`(28px)·`icon`(32px)을 override 없이 쓰는 곳이 101곳이라 모바일 터치 영역이 44px에 못 미친다.
- 수정: (1) `FE/lib/components/ui/confirm-dialog/`(index.ts + confirm-dialog.svelte)를 신설. 기존 `ConfirmAction`의 `ask(message, heading, acceptLabel): Promise<boolean>` API를 그대로 유지하고, 옵션으로 `ask({ title, description, confirmLabel, destructive?, reason?: { label, required, placeholder } })` 형태를 추가해 Textarea로 사유를 받으면 `Promise<{ confirmed: boolean; reason?: string }>`를 돌려준다(기존 시그니처 호출은 boolean 유지 — 오버로드). 스타일은 `ui/dialog` 규칙(토큰 색, 닫기 라벨 "닫기")을 따른다. `admin/ConfirmAction.svelte`는 새 컴포넌트를 re-export하는 얇은 래퍼로 바꿔 admin 6개 화면의 import가 깨지지 않게 한다. (2) checklist의 `window.prompt` 2곳을 사유 필수 ConfirmDialog로 교체(문구는 기존 그대로 ~해요체, 반려·삭제 동작·API 호출 순서 불변). (3) Button에 `size="touch"`(`h-11 px-4 text-sm`)와 `"icon-touch"`(`size-11`)를 추가. 기존 크기·기본값은 바꾸지 않는다.
- 완료: svelte-check 통과, admin 6개 화면 import 무변경으로 컴파일, checklist에서 `window.prompt` 0건, `tests/smoke`에 `confirm-dialog-contract.cjs`(ask API·reason 옵션·ConfirmAction re-export·Button touch 크기 존재 확인, 기존 `*-contract.cjs` 방식)를 추가하고 `tests/run-quality.cjs` 목록에 등록.

### B-62 [med] 페이지·상태 공통 컴포넌트 신설과 시범 적용
- 위치: `FE/lib/components/ui/`(신규), 시범 적용 `FE/routes/app/schedule/+page.svelte:~480`, `FE/routes/app/p/[pid]/manage/settings/+page.svelte:~146`, `FE/routes/app/p/[pid]/manage/casting/+page.svelte:~278`(오류 패널 카드형 3곳), `FE/routes/app/notifications/+page.svelte`와 `FE/routes/admin/members/[id]/+page.svelte`(h1 없음)
- 결함: 오류 패널이 3가지 모양(카드형·테두리 박스·빨간 한 줄)이고 재시도 문구가 "다시 불러오기/다시 시도/새로고침"으로 제각각, 페이지 제목 크기(`text-xl/2xl/3xl`)·최대 너비가 화면마다 다르며, 상태 배지·빈 상태·폼 필드가 화면마다 직접 마크업이다. 두 화면은 h1이 없다.
- 수정: 다음 컴포넌트를 `FE/lib/components/ui/<이름>/`(index.ts + .svelte)로 신설. 색은 토큰만 쓰고(`text-destructive`, `bg-muted` 등) 해요체 기본 문구를 둔다. (1) `page-header` — props `title`, `description?`, 우측 `actions` snippet, h1 제목 `text-xl sm:text-2xl`. (2) `page-container` — `size: "narrow"(max-w-xl) | "default"(max-w-5xl) | "wide"(max-w-6xl)`. (3) `error-panel` — `message`, `onRetry?`, 재시도 버튼 문구는 "다시 시도"로 통일, `role="alert"`. (4) `loading-block` — Skeleton 줄 수 `lines`. (5) `empty-state` — `title`, `description?`, `action` snippet(dashed border). (6) `status-badge` — `tone: "neutral"|"success"|"warning"|"danger"|"info"`을 기존 `ui/badge` variant·토큰으로 매핑(직접 `bg-red-500/10` 금지, 필요하면 `app.css`에 `--success`/`--warning` 토큰과 `text-success` 등 유틸 추가, 다크 대응). (7) `form-field` — `label`, `for`(id), `hint?`, `error?`, 컨트롤 snippet(`<Label for>` 연결). 시범 적용은 위 5개 화면에만: 오류 패널 3곳을 `error-panel`로, h1 없는 두 화면에 `page-header`(또는 최소한 sr-only h1) 추가. 나머지 화면 치환은 하지 않는다.
- 완료: svelte-check 통과, 새 컴포넌트마다 props 타입 명시, 시범 5개 화면에서 동작·문구 의미 불변(재시도 시 같은 로드 함수 호출), `tests/smoke/ui-standard-contract.cjs`(각 컴포넌트 index.ts export 존재, error-panel이 `role="alert"` 포함, status-badge에 raw red/green 팔레트 클래스 없음)를 추가하고 `tests/run-quality.cjs`에 등록.

### B-63 [med] Storybook 도입 (B-61·B-62 뒤)
- 위치: `frontend/package.json`, `frontend/.storybook/`(신규), 스토리 `FE/lib/components/ui/**/*.stories.svelte`, 루트 `.gitignore`
- 요구: shadcn-svelte `ui/` 컴포넌트와 B-61·B-62가 만든 표준 컴포넌트를 스토리로 보면서 variant·size·다크·모바일 폭을 확인하고 a11y 점검을 할 수 있게 한다. 근거: `@storybook/sveltekit` 10.6.3은 svelte ^5, vite ^5~^8, vite-plugin-svelte ^2~^7 지원(npm peerDependencies로 확인, 이 프로젝트는 svelte 5.56·vite 7.3·vite-plugin-svelte 6·Node 22).
- 수정: (1) frontend devDependencies에 `storybook`, `@storybook/sveltekit`, `@storybook/addon-svelte-csf`, `@storybook/addon-a11y`, `@storybook/addon-docs`를 같은 메이저(10.x)로 설치하고 lockfile 갱신(운영 의존성에 넣지 않는다). 설치 전에 `npm view <패키지> peerDependencies`로 프로젝트 버전과 맞는지 다시 확인하고 안 맞으면 멈추고 보고한다. scripts에 `"storybook": "storybook dev -p 6006 --host 127.0.0.1"`, `"build-storybook": "storybook build"` 추가(기존 `dev`·`build`·`check` 불변, `npm run build`가 Storybook 때문에 느려지거나 깨지면 안 된다). (2) `.storybook/main.ts`(framework `@storybook/sveltekit`, stories `../src/**/*.stories.@(svelte|ts)`, addons), `.storybook/preview.ts`(`../src/app.css` import, 배경/다크 전환 툴바 — `<html class="dark">` 토글 데코레이터 또는 `globalTypes`, 모바일 뷰포트 프리셋), 필요하면 `.storybook/preview-head.html`로 Pretendard 폰트. (3) 스토리: `ui/button`(variant×size 전부, touch 포함), `badge`, `input`, `select`, `textarea`, `switch`, `tabs`, `dialog`, `card`, `skeleton`, `table` 와 B-61·B-62의 `confirm-dialog`, `page-header`, `error-panel`, `empty-state`, `status-badge`, `form-field`, `loading-block`. 스토리는 `apiRequest`·소켓·라우트 store에 의존하지 않는다. (4) `.gitignore`에 `storybook-static/`와 `*storybook.log` 추가. (5) `DEVELOPMENT.md`에 "Storybook 실행(`npm --prefix frontend run storybook`)과 새 UI 컴포넌트는 스토리 같이 추가" 절을 짧게 추가.
- 완료: `npm --prefix frontend run build-storybook`이 성공(경고는 보고), `npm run check`(svelte-check에 스토리 파일 포함) 0 오류, 기존 `npm run build` 영향 없음. 개발 서버 실행 후 브라우저 확인은 지휘자가 한다.

2026-10-23 3차 사이클 — auditor 2개 병렬 재감사 후 fixer가 구현했어요. 시작 시 남아 있던 B-40 관련 변경은 스냅샷으로 보존했어요.

- B-39 초대 PENDING 조건부 선점과 멤버·역할 단일 transaction, 동시 수락 회귀.
- B-40 브라우저 canvas·WebAudio·MediaRecorder 실시간 MP4/WebM 내보내기, 8개 순수 회귀, CORS 운영 절차.
- B-41 대본 관리 감사 완료. 기존 B-43~B-52 재검증·수정 방향 보완, 신규 B-58 추가.
- B-42 일정 관리 감사 완료. 기존 B-53~B-57 재검증·범위 보완, 신규 B-59 추가.
- B-43~B-47·B-58 대본 snapshot 개인정보·삭제 차단·파서·동시 순서·입력 제한·시간 복원.
- B-48~B-52 대사 충돌 복구·등록 재시도·읽기 오류/해시·검색/내 대사/인쇄·글자/배역/대비.
- B-53~B-57·B-59 일정 충돌/응답·suggest 권한·알림·ICS·입력 제한·화면 접근성/회의 링크/복제/집계·휴지통 장면 제외.
- root 리뷰 보완: 대본 초기 조회/선택 경합, 대본 인쇄 shell 제거, 같은 공연 충돌을 타 공연으로 표시하지 않도록 수정.
- 검증 재현성: 전체 gate에서 사용하는 scene-line-draft·timeline-export contract를 gitignore 예외로 포함했어요.
- B-60 브라우저에서 추가 발견한 게스트 접근 종료 후 내용 잔존 수정, terminal 오류와 일시 장애 구분·늦은 응답 차단, 회귀 10개.
- 최종 전체 게이트: `npm run check` PASS(svelte-check 0 오류·0 경고), `npm run test` PASS(61 suites / 514 tests + guest 수명 10개 등 회귀 스크립트), `npm run build` PASS.
- 커밋: `10677ad` 3차 사이클 구현, `17b8a10` 게스트 접근 종료 수정. push·운영 배포 없음.

화면 확인 2026-10-23 — 실제 로컬 앱+사용자가 확인한 분리된 개발 PostgreSQL, Playwright Chrome.

- desktop 20/20 PASS: 큐 이동/삭제/공연 전환(B-01~03), 관리 4화면 A→B 분리·503 재시도(B-10~12), 관리자 조회 실패·삭제 확인(B-06~08), 일정 실패·개인 일정 삭제 확인(B-14~15), 게스트 링크 철회/공연 삭제(B-19·B-37·B-60), 같은 비밀번호 거부(B-21), 대본 검색/내 배역/크기/인쇄(B-51~52), 회의 링크/미정/복제/ICS(B-56~57).
- B-01 강화 검사: 재생 70초·zoom 100·scrollLeft 120 유지, cue startMs 30000→25000 실제 API 재조회 PASS.
- mobile viewport 390×844 핵심 4화면 PASS. 실제 mobile 기기 검증은 수행하지 않았어요.
- MP4: 실제 0~60초 녹화 파일 30,712,730 bytes, H.264 1280×720·AAC, 길이 60.0389초. 브라우저 전체 길이·58초 seek 이후 59초 재생·0/30/59초 배경/자막/장면 제목·무음 아님 확인. 별도 5초 파일에서 영상 440Hz+음원 큐 880Hz 혼합도 확인.
- 실DB 회귀 4건 PASS: B-46 동시 막6/장면6/가져오기2 순서 유일, B-43 ACTOR/STAFF/GUEST 비공개 주석·snapshot 차단, B-58 시간1250/4250ms 복원, B-39 동시 수락201/400·membership/role 각1개.
- 전용 SUPER_ADMIN은 BLOCKED·활성 AuthSession 0개, 기존 토큰·재로그인401 확인. 기존 사용자·공연 불변. QA 데이터·미디어는 보존했어요(삭제전용 QA공연은 soft delete, QA링크는 철회).
- 증거: `artifacts/cycle3/REPORT.md`, 화면/guest/mobile/drag/mp4/mix 결과 JSON, DB 회귀 JSON, 최종 check/test/build 로그. artifacts는 gitignore로 로컬 보관해요.

### 3차 사이클 완료 카드 설계와 감사 근거

2026-10-23 사용자 요청 — 3차 사이클 구현 완료. 시작 스냅샷 `e7db0dd37deb9cacdfa17f1ff7ece60d5cc3185c`에 기존 B-40 미커밋 구현을 보존했어요. 순서: B-41·B-42 감사(병렬) → B-40 구현 → 감사로 나온 카드 + B-39 수정.

### B-40 [high] 연습 타임라인(대본+영상)을 MP4로 내려받기
- 위치: `FE/routes/app/p/[pid]/live/+page.svelte`(연습·진행 재생 화면), `FE/lib/domain/rehearsal-timeline.ts`·`composition.ts`(시간 계산·`mediaOwner`), 백엔드 자료 제공 `BE/assets/assets.controller.ts`
- 요구: 연습 화면에서 보이는 것(배경 영상·이미지 + 현재 대사/화자 자막 + 장면 제목 + 음악)을 MP4 파일로 저장.
- 방식(지휘자 결정): 브라우저에서 실시간 녹화. 서버 렌더링(ffmpeg)은 이번 범위 밖.
  1. 연습 화면에 "MP4로 저장" 버튼 → 다이얼로그: 범위(현재 장면 / 현재 막 / 전체 / 시작·끝 지정), 해상도 1280×720 기본·1920×1080 선택, 자막 포함 여부. "선택한 길이만큼 실시간으로 녹화해요. 녹화 중에는 이 탭을 앞에 두세요" 안내와 예상 소요 시간 표시.
  2. 순수 로직은 `FE/lib/domain/timeline-export.ts`로 분리: 범위→시작·끝 ms, 시각 t의 자막(화자·대사)·장면 제목·배경 미디어, MIME 선택. 기존 `buildCompositionRehearsal`/`mediaAt` 계산을 재사용해 연습 화면과 시간이 같게 한다(중복 계산 금지).
  3. 렌더러 컴포넌트 `FE/lib/components/app/timeline-export-dialog.svelte`: 화면 밖 canvas에 매 프레임 배경(영상은 숨긴 `<video crossOrigin="anonymous">`를 해당 시각으로 맞춰 재생, 이미지는 `<img crossOrigin="anonymous">`)과 자막을 그림. 음악·영상 소리는 `AudioContext.createMediaElementSource` → `MediaStreamDestination`. `canvas.captureStream(30)` 영상 트랙 + 오디오 트랙을 `MediaRecorder`로 녹화.
  4. MIME은 `MediaRecorder.isTypeSupported`로 `video/mp4;codecs=avc1.42E01E,mp4a.40.2` → `video/mp4` 순서로 시도하고, 둘 다 안 되면 `video/webm;codecs=vp9,opus`로 저장하면서 "이 브라우저는 MP4 녹화를 지원하지 않아 WebM으로 저장했어요(Chrome·Edge 최신, Safari 권장)"라고 안내.
  5. 진행률(경과/전체)·취소 버튼, 완료 시 `<공연명>_<범위>.mp4` 다운로드. 탭이 숨겨지면(`visibilitychange`) 일시정지 경고. 정리 시 모든 media·AudioContext·트랙 해제.
  6. CORS: canvas가 오염되면(`SecurityError`) "영상 서버의 CORS 설정이 필요해요" 오류를 보여 준다. 로컬 자료 제공 경로가 `CORS_ORIGINS`에 대해 `Access-Control-Allow-Origin`을 돌려주는지 확인하고 없으면 추가한다. R2 버킷 CORS(GET, `APP_PUBLIC_URL` 허용)는 운영 설정이므로 `SITE_OPERATIONS.md`에 절차만 추가한다.
- 완료: `timeline-export.ts` 회귀 스크립트(`tests/smoke/timeline-export-contract.cjs`, 기존 `*-contract.cjs` 방식)를 `tests/run-quality.cjs` test 목록에 등록, svelte-check 통과, 로컬에서 1분 범위 녹화 파일이 재생되는지 브라우저로 확인.

3차 사이클 감사(B-41 대본, B-42 일정) 결과 카드. 2026-10-23 auditor 2개로 실제 코드를 병렬 재감사했고 아래 수정 방향을 보완했어요. B-58·B-59는 이번 감사에서 새로 확인했어요.

### 대본 — 백엔드 (BE/scripts, 같은 파일이라 한 묶음씩 순차)
- B-43 [high] BE/scripts/scripts.service.ts:1251,1258-1280,208,169 — 버전 스냅샷(`buildScriptSnapshot`)이 `scriptDetailInclude()`를 그대로 써서 versions·imports·전 사용자 annotations가 스냅샷에 중첩 저장되고, getScript/listScripts가 `versions[].snapshot`을 ACTOR·STAFF·GUEST에도 내려 남의 비공개 주석이 샌다. → 스냅샷 전용 include(acts/scenes/blocks만), getScript·listScripts 응답에서는 snapshot을 빼고 id·label·createdAt·authorId만. 완료: spec(스냅샷에 versions/annotations 없음, 목록 응답에 snapshot 없음).
- B-44 [med] BE/scripts/scripts.service.ts:907,915,926,937 — assert 헬퍼(act/scene/block 등)와 restoreVersion `current` 조회가 `script.deletedAt`을 보지 않아 휴지통 대본에도 편집·복원·import·주석이 된다. → where에 `script: { deletedAt: null }`. 완료: spec(삭제 대본 404).
- B-45 [med] BE/scripts/scripts.service.ts:1147-1180 — 가져오기 파서가 화자 정규식을 지문·메모 판별보다 먼저 검사해 "메모: …", "[장면 전환: 암전]"이 화자 대사가 된다. → 지문(`[]`,`()`)·NOTE(`※`)·♪ 검사를 먼저, 화자 검사를 마지막에. 완료: 파서 spec.
- B-46 [med] BE/scripts/scripts.service.ts:~346-381,252-283 — deleteBlock renumber가 줄마다 순차 update인데 `$transaction`에 timeout이 없어(기본 5초) 줄이 많으면 P2028. → `{ timeout: 30000 }`(reorderBlocks는 이미 적용됨). createAct/createScene·applyImport의 maxOrder 계산이 동시 요청 시 order 중복 → createBlock처럼 `$transaction` 안에서 production 행을 먼저 잠그고 계산. 완료: 기존 spec 통과 + 필요 시 추가.
- B-47 [low] BE/scripts/dto.ts — 문자열 상한 없음(`CreateBlockDto.text`, `UpdateBlockDto.text`, title·summary·cueLabel, `CreateScriptVersionDto.label`, `CreateAnnotationDto.content`, `CreateScriptImportDto.rawText`, `ReviewedImportBlockDto.*`, backupLabel, versionName), `@MinLength(1)`은 공백만 있는 값을 통과. → 필드별 `@MaxLength`(text 20000, title 200, label 100, rawText 200000 등) + 공백만 거부. 파일 업로드 추출 결과에도 같은 20만 자 제한 적용. scripts.service.ts 사용자 메시지의 ~습니다체·영어("anchor","force=true")를 ~해요체 한글로. 완료: DTO 검증 spec.

### 대본 — 프론트
- B-48 [med] FE/lib/components/app/scene-line-editor.svelte — (a) :42-58,84-91 줄 이동·삭제 후 서버가 같은 장면 줄 전체 `@updatedAt`을 바꾸는데 `load(true)`가 저장 안 한 draft를 옛 `expectedUpdatedAt`째 보존 → 이후 저장이 가짜 409. 서버 text·type·character가 draft 기준값과 같으면 보존 draft의 `expectedUpdatedAt`만 새 값으로. (b) :60-65 저장 실패(409)가 stale 기준을 그대로 두고 최신본 받는 길이 없음 → 409에서 "최신 줄 불러오기" 버튼. (c) load에 요청 버전 가드(장면 빠른 전환 시 늦은 응답). (d) 줄마다 같은 aria-label → "N번째 줄 내용", 이모지 aria-hidden. (e) `window.confirm` 줄 삭제 → `lib/components/ui/dialog` 확인창. (f) ~습니다체 → ~해요체. 완료: svelte-check.
- B-49 [med] FE/lib/components/app/script-register.svelte:125-141,79-108 — `apply` 성공 뒤 `onCompose` 실패 시 step이 review에 남고 "이대로 등록"을 다시 누르면 대본이 하나 더 생김 → 성공한 `applied.scriptId`를 보관해 재시도는 onPreview·onCompose만. `onDestroy`에서 분석 스트림 abort·timer 정리. ~습니다체 → ~해요체.
- B-50 [med] FE/routes/app/p/[pid]/script/+page.svelte:83-95,242,25-95 — (a) `open()` 실패가 토스트만 뜨고 "등록된 대본이 없습니다" 빈 상태로 보임, 이전 loadError가 성공 뒤에도 남음 → open 실패를 loadError에 넣고 "다시 시도". 초기 목록/대본 조회와 수동 선택이 겹쳐도 늦은 응답·finally가 loading/오류를 덮어쓰지 않도록 요청 버전 가드. (b) 큐시트에서 `/script#scene-<id>`로 오면 composition 뷰(`id=section-…`)에는 앵커가 없어 맨 위에 머문다 → 로딩 후 해시의 scene을 해당 구간으로 매핑해 `scrollIntoView`(매핑이 불가능하면 보고만).
- B-51 [med][feature S] 같은 파일 — 읽기 화면에 대사 검색창(화자·본문, `mark` 하이라이트)과 "내 대사만 보기" 토글, 인쇄 버튼 + `@media print` CSS(장면 nav 숨김, 장면별 page-break, 배경 제거·앱 사이드바/상단/푸터 숨김). 블록 뷰에도 같은 필터(`block.character.id`). BE 변경 없음.
- B-52 [low] 같은 파일 — 블록 뷰(구형 대본)가 `text-[15px]` 고정이라 글자 크기·내 배역 강조가 composition 뷰에만 있음 → `SIZES`·`mine` 공유. 화자 색 고정 hex(#7c3aed 등)의 다크 모드 대비(4.5:1) → 라이트·다크 쌍, `opacity-70` 대신 색 토큰. 장면 `<nav>`에 aria-label. ~습니다체 → ~해요체.

### 일정 — 백엔드 (BE/schedule, 같은 파일이라 순차)
- B-53 [med] BE/schedule/schedule.service.ts:238,274 — updateEvent가 제목·장소만 바꿔도 전 참석자 충돌을 재계산해 강행 배정자가 있으면 overrideReason 없이 409. → 시간·참석자 목록이 바뀔 때만 충돌 검사, 그 외에는 기존 forced 표시 유지. 시간이 바뀌면(timeChanged) 기존 ACCEPTED·TENTATIVE 응답을 INVITED로 되돌리고 알림에 "다시 응답해 주세요". 완료: spec.
- B-54 [med] BE/schedule/schedule.service.ts:662, schedule.controller.ts:133 — sendAttendanceReminders where에 `production: { deletedAt: null }`가 없어 삭제 공연에도 알림·메일. GET schedule/suggest가 GUEST 포함 모든 조회 역할에 열려 타인 개인 일정 시간대를 돌려줌 → `@ProductionRoles(...SCHEDULE_CREATE_ROLES)`로 제한(FE에서 호출하는지 먼저 grep, 호출하면 보고). 완료: spec.
- B-55 [low] BE/schedule — (a) dto.ts MaxLength 없음(title·location·venue·overrideReason·삭제 reason·Availability title·reason) → title 120, location 120, reason류 500. (b) schedule.service.ts:1031,1127,608,598 메일·리마인더·ICS에 `유형: READING` 영어 enum 노출 → 한글 라벨(리딩/음악연습/리허설 등 기존 `EVENT_TYPE_LABELS`와 일치)로, 새 문구는 ~해요체. (c) :1171 foldIcsLine을 UTF-16 길이 75자 대신 바이트(코드포인트 단위) 75옥텟 기준으로. (d) :454 관리자 출석 저장에서 status 미지정 시 `?? INVITED`로 기존 응답을 덮어씀 → update에서는 정의된 경우만 갱신. 완료: spec.

### 일정 — 프론트 (두 페이지 + 순차)
- B-56 [med] FE/routes/app/p/[pid]/schedule/+page.svelte, FE/routes/app/schedule/+page.svelte — (a) 공연별 페이지의 createEvent·confirmDelete try 안의 reloadEvents 실패가 "등록하지 못했습니다"로 보여 중복 등록 유발 → 성공 처리 뒤 reloadEvents는 별도 try, 실패 시 "목록을 새로고침하지 못했어요"만. (b) 충돌 안내가 "개인 일정: 개인 일정과 겹침"처럼 중복이고 같은 사람이 여러 줄 → 사용자별로 묶고 유형 라벨 중복 제거, 응답의 겹친 시간대 표시. (c) 달력 날짜 버튼에 `aria-label="10월 5일, 일정 N개"`·`aria-pressed`, 이전/다음 달 버튼 최소 44px, p/[pid]/schedule의 moveMonth가 선택일을 갱신하도록(app/schedule과 동일). (d) "유형"·"공유 범위" Label을 Select.Trigger와 연결. (e) ~습니다체 → ~해요체. (f) 두 페이지 모두 TENTATIVE를 "미정"으로 분리하고 응답 버튼에 "미정" 추가(BE 지원됨).
- B-57 [low][feature S] 같은 두 파일(B-56 뒤) — 회의 링크(meetingUrl) 입력·상세 표시("회의 링크 열기", http(s)만 허용), `/app/schedule`에 "캘린더에 추가(.ics 받기)" 버튼(`GET schedule/me/ics`는 Bearer라 `apiRequest<string>()` 결과를 Blob으로 만들어 다운로드), 일정 복제(카드 "복제" → 추가 다이얼로그를 기존 값으로 채우고 날짜만 비움), 카드 헤더에 "참석 N · 불참 N · 미응답 N / 전체" 칩.

### B-58 [med] 대본 버전 복원 시 대사 시간 누락
- 위치: `BE/scripts/scripts.service.ts` normalizeScriptSnapshot·restoreVersion
- 결함: snapshot에 저장된 `startMs`·`durationMs`를 정규화와 upsert에서 버려 복원 후 연습 타임라인이 달라져요.
- 수정: SnapshotBlock의 nullable 시간 필드를 정규화하고 복원 update/create에 반영해요. 필드 없는 과거 snapshot은 null로 호환해요.
- 완료: 시간 복원·과거 snapshot 호환 회귀 spec.

### B-59 [med] 일정에 휴지통 대본 장면 연결 허용
- 위치: `BE/schedule/schedule.service.ts` assertScenes·getProductionScenes
- 결함: 삭제된 대본의 장면도 새 일정 연결에 허용하고 장면 선택 목록에 반환해요.
- 수정: 관계 where에 `script: { productionId, deletedAt: null }`을 추가해요. 기존 연결 이력은 유지해요.
- 완료: 삭제 대본 장면이 목록·새 연결에서 제외되는 spec.

### B-60 [med] 게스트 접근 철회 뒤 이전 공연 내용이 화면에 남음
- 위치: `FE/routes/(legacy)/r/[token]/+page.svelte` notification.error·disconnect 처리
- 결함: 연결된 QA 게스트 링크 철회 또는 공연 soft delete 후 오류 메시지만 바뀌고 workspace의 공연·일정·장면 내용이 계속 표시돼요. 2026-10-23 실제 브라우저에서 재현했어요.
- 수정: 접근 철회·만료·삭제 오류는 workspace·readingSession·큐/장면 등 보호 상태를 지우고 소켓을 정리해 접근 종료 화면만 표시해요. 일시적인 연결 장애와는 구분해요.
- 상태: 완료(2026-10-23, `17b8a10`). 접근 종료 뒤 내용 제거·늦은 REST/socket 무효화, 일시 장애 fallback 보존. 회귀 10개 및 전체 check/test/build PASS. 실제 링크 철회 193ms·공연 soft delete 141ms 내 접근 종료·내용 제거, REST 410/404 확인.
- 완료: B-19·B-37 실제 브라우저 재검증과 관련 회귀·check/test.

2026-10-23 1차 사이클 — Sonnet 감사 2 + Sonnet fixer 8묶음, 지휘자 리뷰 후 승인.

- B-01 큐시트 재조회 때 CueStudio 유지(첫 로드만 스켈레톤)
- B-02 큐 삭제 확인창(편집 다이얼로그·타임라인 둘 다)
- B-03 공연 전환 시 큐시트 상태 초기화
- B-04 배경 영상 서명은 배경 구성 변경 시에만, 8분 주기 갱신 유지
- B-05 큐시트 문구 ~해요체
- B-06 관리자 회원 상세 조회 실패 화면·다시 시도
- B-07 관리자 공연 목록·휴지통 오류를 "없음"과 구분
- B-08 관리자 기획 메모·개인 일정 삭제 확인
- B-09 관리자 표 이름 링크·aria-label·Label for
- B-10 settings·planning pid 반응 로드 + 응답 가드
- B-11 설정 화면 403만 권한 없음, 그 외 오류+다시 시도
- B-12 멤버·캐스팅 공연 전환 시 상태 리셋·응답 가드·debounce 정리
- B-13 관리 화면 4개 문구 ~해요체
- B-14 일정 두 화면 조회 실패 패널
- B-15 개인 일정 삭제 확인
- B-16 진행 화면 서명 URL 20초 주기 점검·만료 60초 전 재서명
- B-17 게스트 화면 언마운트 후 소켓 생성 방지
- B-18 dialog·sheet "Close" → "닫기"
- B-19 게스트 링크 철회 시 소켓 끊기, 만료 소켓 정리, 삭제 공연 게스트 접속·조회 404 (spec)
- B-20 fireCue 서버 필드 덮어쓰기 차단 + payload 2KB 제한 (spec)
- B-21 /users/me/password 레이트리밋 + 같은 비밀번호 거부 (spec)
- B-22 trust proxy 1단 + 가드는 request.ip만 (spec)
- B-23 enableShutdownHooks
- B-24 ORG_ADMIN이 관리자 계정 차단·프로필 요청 불가 (spec)
- B-25 전역 PrismaExceptionFilter(P2002/P2003/P2028/P2034→409, P2025→404, 나머지 Nest 기본 처리) (spec)
- B-26 트랙 이름 중복 409 (spec)
- B-27 체크리스트 담당자 배열 ArrayUnique·상한·uuid, createMany
- B-28 addMembers 제작자 유지 확인·userIds 상한/uuid·트랜잭션 20초 (spec)
- B-29 삭제 공연 대시보드 404 (spec)
- B-30 공연 검색에서 삭제 대본 제외

2026-10-23 2차 사이클 — fixer 7묶음(I·J·K·N → L·M·O), 리뷰 후 2건 재지시(Prisma 필터 로그 유지는 1차, 로그인 비밀번호 상한 1024).

- B-31 대본 가져오기 DRAFT 조건부 선점(동시 적용 409) + createMany, 트랜잭션 30초, 배열 상한 (spec)
- B-32 출석 일괄 저장 트랜잭션, put* createMany, 일정 DTO 배열 상한, suggest id 200개 제한 (spec)
- B-33 알림 createManyAndReturn 1회, 메일은 같은 틱 호출 묶어 수신 설정 조회 1회+삽입 1회, take IsInt (spec)
- B-34 productions·checklist·admin·auth·music DTO 문자열·정수·배열 상한 (로그인·현재 비밀번호는 1024)
- B-35 소켓 토큰 query string 거부, AI 업로드 추출 텍스트 20만 자 초과 400 (spec)
- B-36 RolesGuard 역할 매트릭스·초대 흐름 spec 48개
- B-37 공연 삭제 시 게스트 소켓 즉시 끊기 (spec)
- B-38 큐시트 서명 URL 캐시에 서명 시각 저장, 7분 지난 항목 재서명
