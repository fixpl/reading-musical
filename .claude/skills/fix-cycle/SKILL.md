---
name: fix-cycle
description: 리딩뮤지컬 저장소의 감사→백로그→Sonnet 수정→게이트→리뷰 사이클을 실행한다. "점검하고 고쳐줘", "백로그 처리", "개선 사이클" 요청에 사용. 인자: audit | fix [카드ID...] | (없으면 백로그의 TODO 처리)
---

# fix-cycle

지휘자(현재 세션)는 판단·분류·리뷰만 하고, 읽기 많은 일과 수정은 Sonnet 에이전트에 맡긴다. 지휘자는 큰 파일을 직접 통째로 읽지 않는다.

시작 전에 `HANDOFF.md`의 현재 단계와 결정 사항을 확인한다. 사이클이 끝나면 `HANDOFF.md` 1절(현재 상태)을 갱신한다.

## audit (백로그가 비었거나 사용자가 점검을 요청할 때)

1. 범위를 2~4개로 나눈다(예: backend 권한·검증 / backend 성능·오류 매핑 / frontend 앱 화면 / frontend 관리자 화면).
2. 범위마다 `auditor` 에이전트를 병렬로 띄운다. 프롬프트에 범위, 이미 고친 항목(BACKLOG.md DONE), 보고 형식만 준다.
3. 결과에서 오탐·중복을 거른다. 의심스러운 high 항목만 지휘자가 해당 줄 주변(±30줄)을 직접 확인한다.
4. `BACKLOG.md`의 TODO에 카드로 추가한다.

## fix

0. **fixer를 띄우기 직전에** `sh scripts/agent-snapshot.sh save`. 작업 트리에 커밋 안 된 변경이 많아 `git diff HEAD`로는 에이전트 변경분만 볼 수 없다.
1. `BACKLOG.md`에서 TODO 카드를 고른다(high 먼저). 파일이 겹치는 카드는 같은 묶음으로.
2. 묶음당 카드 1~3장으로 `fixer` 에이전트를 띄운다(이 세션에 `fixer` 타입이 아직 없으면 `general-purpose` + `model: sonnet`으로 띄우고 첫 줄에 `.claude/agents/fixer.md`를 읽으라고 지시). 파일이 겹치지 않는 묶음은 병렬로(최대 4개). 프롬프트에는 카드 원문만 붙인다 — 지휘자가 읽은 코드를 다시 설명하지 않는다.
3. 보고가 오면 `sh scripts/agent-snapshot.sh diff <보고된 files>`만 읽어 리뷰한다. 문제가 있으면 같은 fixer에게 SendMessage로 한 줄 지시.
4. 통과한 카드는 `BACKLOG.md`에서 DONE으로 옮긴다(날짜·한 줄 결과).
5. 모든 묶음이 끝나면 `npm run check`와 `npm run test`를 백그라운드로 1회 실행해 확인한다.
6. 커밋은 사용자가 요청할 때만.

## 카드 형식

```
### B-<번호> [high|med|low] 제목
- 위치: path:line (관련 파일)
- 결함: 무엇이 어떻게 잘못되는가 (재현 조건)
- 수정: 어떤 방향으로 고치는가 (선택지가 있으면 지휘자가 정해서 하나만)
- 완료: 어떤 테스트/동작으로 확인하는가
```

## 토큰 절약 규칙

- 에이전트 보고는 형식 고정·줄 수 제한. 코드 붙여넣기 금지.
- 검증은 `verify-changed.mjs --files`로 변경분만. 전체 게이트는 사이클 끝에 1회.
- 같은 맥락이 필요한 후속 수정은 새 에이전트 대신 기존 fixer에 SendMessage.
- `CLAUDE.md`가 지도 역할을 하므로 탐색 단계를 프롬프트에 넣지 않는다.
