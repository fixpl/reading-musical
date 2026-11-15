import { PHASE_LABELS } from "$lib/domain/labels";

export type OperationStep = { key: string; label: string; done: boolean; detail: string };

export type ProductionReadiness = {
  id: string;
  title: string;
  currentPhase: string;
  archived?: boolean;
  venue: string | null;
  steps: OperationStep[];
  attention: string[];
  nextEventAt: string | null;
  lastActivityAt: string | null;
  casting?: { done: boolean; detail: string };
  scriptPreparation?: { hasMaterial: boolean; hasRegisteredScript: boolean; hasLinkedScene: boolean };
};

export type PhaseCount = { key: string; label: string; count: number };

/** 등록된 공연의 현재 단계를 세며, 새 단계가 생겨도 전체 수에서 빠뜨리지 않는다. */
export function countProductionPhases(productions: Pick<ProductionReadiness, "currentPhase">[]): PhaseCount[] {
  const counts = new Map(Object.keys(PHASE_LABELS).map((key) => [key, 0]));
  for (const production of productions) {
    counts.set(production.currentPhase, (counts.get(production.currentPhase) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ key, label: PHASE_LABELS[key] ?? key, count }));
}

export function readinessStepLink(productionId: string, key: string) {
  const base = `/app/p/${productionId}`;
  const routes: Record<string, string> = {
    members: "/manage/members",
    casting: "/manage/casting",
    script: "/composition",
    video: "/composition?tab=videos",
    cues: "/cuesheet",
    schedule: "/schedule"
  };
  return `${base}${routes[key] ?? ""}`;
}

export function readinessStepState(step: OperationStep) {
  if (step.detail === "해당 없음") return "해당 없음";
  return step.done ? "등록됨" : "추가 필요";
}

export function rehearsalPreparationSteps(show: Pick<ProductionReadiness, "steps" | "scriptPreparation">) {
  const script = show.scriptPreparation;
  if (!script) return show.steps;
  return show.steps.map((step) => step.key === "script" ? {
    ...step,
    done: script.hasMaterial,
    detail: script.hasMaterial ? "연습할 대본 있음" : script.hasLinkedScene ? "장면 내용 없음" : script.hasRegisteredScript ? "구성 전" : "대본 없음"
  } : step);
}

/** 다음 연습을 준비하는 순서. 영상과 큐는 공연에 맞춰 별도로 점검한다. */
export function nextRehearsalTask(show: Pick<ProductionReadiness, "steps" | "casting" | "scriptPreparation">) {
  const step = show.steps.find((item) => item.key === "script");
  const script = show.scriptPreparation ?? (step ? {
    hasMaterial: step.done, hasRegisteredScript: step.detail === "구성 전", hasLinkedScene: false
  } : null);
  const scriptTask = nextScriptTask(script);
  if (scriptTask) return scriptTask;
  if (show.steps.some((step) => step.key === "members" && !step.done)) {
    return { key: "members", label: "공연팀 추가하기" };
  }
  if (show.casting && !show.casting.done && show.casting.detail !== "배역 없음") {
    return { key: "casting", label: "배역 배정하기" };
  }
  if (show.steps.some((step) => step.key === "schedule" && !step.done)) {
    return { key: "schedule", label: "다음 일정 잡기", query: "?create=1" };
  }
  return null;
}

export function nextScriptTask(script: ProductionReadiness["scriptPreparation"] | null) {
  if (!script || script.hasMaterial) return null;
  if (script.hasLinkedScene) return { key: "script", label: "장면 내용 입력하기" };
  return script.hasRegisteredScript
    ? { key: "script", label: "장면 구성하기", query: "?tab=import" }
    : { key: "script", label: "대본 등록하기", query: "?tab=register" };
}
