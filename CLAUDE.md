# 리딩뮤지컬 (아트브릿지) — 에이전트 작업 지도

이 파일은 모든 Claude 세션·서브에이전트가 먼저 읽는다. 저장소를 다시 훑지 말고 여기서 위치를 찾은 뒤 필요한 파일만 연다.

**진행 중인 작업과 다음 단계는 `HANDOFF.md`에 있다.** 새 세션은 이 파일 다음에 `HANDOFF.md`를 읽는다.

## 구조

- `backend/` NestJS 11 + Prisma(PostgreSQL). REST `/api/v1`, Socket.IO `/ws`. 모듈별 `*.controller.ts` / `*.service.ts` / `dto.ts`, 테스트는 같은 폴더 `*.spec.ts`(Jest, DB 없이 mock).
  - 권한: `common/guards/roles.guard.ts`, `common/decorators/production-roles.decorator.ts`, `common/access/is-production-admin.ts`, 삭제 공연 차단 `productions/production-availability.guard.ts`.
  - 레이트리밋: `common/decorators/rate-limit.decorator.ts` + `common/guards/rate-limit.guard.ts`.
  - 큰 서비스: productions · schedule · scripts · admin · reading-sessions · run-sheets · dashboard · ai.
- `frontend/` SvelteKit 2 + Svelte 5 runes, shadcn-svelte(`lib/components/ui`).
  - 사용자 화면 `/app`(공연별 `/app/p/[pid]/...`), 운영 콘솔 `/admin`(SUPER_ADMIN). 옛 라우트는 `hooks.server.ts`가 308 처리 — **삭제된 라우트 링크를 되살리지 않는다.**
  - API 호출은 반드시 `lib/api/client.ts`(`apiRequest`) 경유. frontend에서 backend/Prisma import 금지.
  - 도메인 계산은 `lib/domain/*.ts`(순수 함수). 큰 컴포넌트: `lib/components/app/cue-studio.svelte`, `routes/app/p/[pid]/cuesheet`.
- `tests/run-quality.cjs` 전체 게이트, `scripts/verify-changed.mjs` 변경분 빠른 게이트.
- 운영 문서: `README.md`, `DEVELOPMENT.md`, `SITE_OPERATIONS.md`, 정식 오픈 `LAUNCH_READINESS.md`. `docs/`의 예전 배포 runbook은 로컬 참고이며 Docker/Railpack의 실제 시작 동작을 먼저 확인한다.

## 명령

| 목적 | 명령 | 시간 |
| --- | --- | --- |
| 수정 1건 검증 | `node scripts/verify-changed.mjs --files <쉼표로 구분한 경로>` | 수 초~1분 |
| 타입·빌드 전체 | `npm run check` | ~2분 |
| 테스트 전체 | `npm run test` (Jest + 회귀 스크립트) | ~2분 |
| 로컬 실행 | `sh dev.sh --allow-remote-db` | — |

작업 트리에 커밋 안 된 다른 변경이 많으므로 빠른 게이트에는 항상 `--files`를 준다.

## 규칙

- 사용자에게 보이는 문구는 한국어 존댓말 `~해요`체로 통일(새 문구 기준). 영어 라벨 노출 금지.
- 강행(충돌 무시 배정)은 운영자·제작진만. 배우·스태프는 `canOverride:false`.
- 회원 검색은 "타 조직 소속만 제외" 스코프 + 이메일 마스킹(`mask-emails.interceptor.ts`).
- 삭제·되돌릴 수 없는 동작은 확인 다이얼로그(`lib/components/ui/dialog`) 뒤에 둔다.
- 운영 DB·환경 파일·migration 적용은 하지 않는다. 스키마 변경이 필요하면 멈추고 보고한다.

## 작업 사이클 (Opus 지휘 · Sonnet 수정)

토큰을 아끼려고 역할을 나눈다. 순서: **감사 → 백로그 → 카드 → 수정 → 게이트 → 리뷰 → 커밋**.

1. **감사** `auditor` 에이전트(Sonnet, 읽기 전용)가 범위 하나씩 훑고 `[SEV] path:line — 결함 — 수정안` 형식으로만 보고.
2. **백로그** 지휘자(Opus)가 중복·오탐을 거르고 `BACKLOG.md`에 카드로 적는다. 카드 = 파일·결함·수정 방향·완료 조건.
3. **수정** 카드 1~3장씩 `fixer` 에이전트(Sonnet)에 넘긴다. 서로 다른 파일을 건드리는 카드끼리는 병렬로.
4. **게이트** fixer가 `verify-changed.mjs --files`로 자기 변경만 검증하고 10줄 이내로 보고.
5. **리뷰** 지휘자가 수정 전에 찍은 스냅샷 기준 `sh scripts/agent-snapshot.sh diff <파일>`만 읽고 확인(기존 미커밋 변경과 분리). 모든 카드가 끝나면 `npm run check && npm run test` 1회.
6. **커밋** 사용자가 요청할 때만.

`/fix-cycle` 스킬이 이 순서를 실행한다.
