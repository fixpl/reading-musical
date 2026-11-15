import { captureSession, isCurrentSession, type ClientSession } from "./session";

export type ProductionAssistantDraft = { title: string; venue: string; startDate: string; synopsis: string };

type ScheduleTimeRange = { startAt: string; endAt: string };
export type AssistantScheduleEvent = ScheduleTimeRange & { id: string; title: string; productionId: string; productionTitle: string };
export type AssistantSchedulePreview = {
  event: AssistantScheduleEvent;
  before: ScheduleTimeRange;
  after: ScheduleTimeRange;
  timeChanged: boolean;
  reconfirm: Array<{ id: string; name: string; status: "ACCEPTED" | "TENTATIVE" }>;
  conflicts: Array<ScheduleTimeRange & { userName: string; reason: string }>;
  approvalToken: string | null;
};
export type AssistantScheduleConfirmation =
  | { status: "saved"; notificationWarning: boolean; previouslySaved: boolean }
  | { status: "review"; preview: AssistantSchedulePreview };

export type ProductionAssistantAnswer = {
  answer: string;
  draft: ProductionAssistantDraft | null;
  schedule?: { focus: AssistantScheduleEvent | null; matches: AssistantScheduleEvent[]; hasMore: boolean; preview: AssistantSchedulePreview | null; reviewRequested: boolean };
  evidence: {
    query: string;
    scope: string;
    filter: string;
    from: string | null;
    to: string | null;
    total: number;
    needsAttention: number;
    items: Array<{
      id: string;
      title: string;
      archived: boolean;
      startDate: string | null;
      nextEventAt: string | null;
      attention: string[];
      readiness: Array<{ key: string; label: string; detail: string; done: boolean }>;
      casting: { done: boolean; detail: string };
    }>;
  } | null;
};

let pending: { draft: ProductionAssistantDraft; session: ClientSession } | undefined;

export function prepareProductionDraft(draft: ProductionAssistantDraft, session: ClientSession) {
  if (session.owner && isCurrentSession(session)) pending = { draft: { ...draft }, session };
}

export function takeProductionDraft() {
  const transfer = pending;
  pending = undefined;
  if (transfer && captureSession().owner && isCurrentSession(transfer.session)) return transfer.draft;
}
