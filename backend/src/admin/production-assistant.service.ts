import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PlatformRole } from "@prisma/client";
import { runResponses } from "../ai/harness/responses-harness";
import type { RequestUser } from "../common/types/request-user";
import { AdminOpsService } from "./admin-ops.service";
import { AssistantScheduleService, isIsoDate, seoulScheduleTime } from "./assistant-schedule.service";

type ProductionDraft = { title: string; venue: string; startDate: string; synopsis: string };
type AssistantAnswer = { answer: string; draft: ProductionDraft | null; scheduleQuestion?: boolean; reviewRequested?: boolean };
type ProductionSnapshot = Awaited<ReturnType<AdminOpsService["overview"]>>;
type ScheduleMatch = Awaited<ReturnType<AssistantScheduleService["findEvents"]>>["items"][number];
type SchedulePreview = Awaited<ReturnType<AssistantScheduleService["preview"]>>;
const dateInSeoul = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

const textField = { type: "string" };
const answerSchema = {
  type: "object", required: ["answer", "draft", "scheduleQuestion", "reviewRequested"], additionalProperties: false,
  properties: {
    answer: textField,
    scheduleQuestion: { type: "boolean" },
    reviewRequested: { type: "boolean" },
    draft: { anyOf: [
      { type: "null" },
      { type: "object", required: ["title", "venue", "startDate", "synopsis"], additionalProperties: false,
        properties: { title: textField, venue: textField, startDate: textField, synopsis: textField } }
    ] }
  }
};

const normalize = (value: string) => value.normalize("NFC").toLowerCase().replace(/\s+/g, "");
function parseAnswer(text: string): AssistantAnswer {
  const value = JSON.parse(text) as AssistantAnswer;
  if (!value || typeof value.answer !== "string" || !value.answer.trim() || value.answer.length > 2_500) throw new Error("invalid answer");
  if (value.draft === null) return {
    answer: value.answer.trim(), draft: null, scheduleQuestion: value.scheduleQuestion === true, reviewRequested: value.reviewRequested === true
  };
  const fields = value.draft;
  if (!fields || typeof fields.title !== "string" || !fields.title.trim() || fields.title.length > 120 ||
      typeof fields.venue !== "string" || fields.venue.length > 120 ||
      typeof fields.synopsis !== "string" || fields.synopsis.length > 200 ||
      typeof fields.startDate !== "string") throw new Error("invalid draft");
  if (fields.startDate && !isIsoDate(fields.startDate)) throw new Error("invalid draft date");
  return {
    answer: value.answer.trim(),
    draft: { title: fields.title.trim(), venue: fields.venue.trim(), startDate: fields.startDate, synopsis: fields.synopsis.trim() }
  };
}

const scopes = ["active", "archived", "all"] as const;
const filters = ["all", "attention", "unregistered_script", "rehearsal_script", "schedule", "cues"] as const;
type ReadinessFilter = typeof filters[number];
type ProductionReadiness = ProductionSnapshot["items"][number];

function attentionFor(item: ProductionReadiness) {
  const hasEmptyScenes = !item.scriptPreparation.hasMaterial && item.steps.some(step => step.key === "script" && step.done);
  const missingCasting = !item.casting.done && item.casting.detail !== "배역 없음";
  return [...item.attention,
    ...(hasEmptyScenes ? ["구성은 있지만 연습할 대본 내용이 없어요."] : []),
    ...(missingCasting ? ["배우를 배정하지 않은 배역이 있어요."] : [])];
}

function summarize(snapshot: ProductionSnapshot, query: string, scope: string, filter: ReadinessFilter, from: string, to: string) {
  const term = normalize(query);
  const matches = snapshot.items.map(item => ({ ...item, attention: attentionFor(item) })).filter(item => {
    if (scope !== "all" && item.archived !== (scope === "archived")) return false;
    if (term && !normalize(item.title).includes(term)) return false;
    if (from || to) {
      const date = item.startDate ? dateInSeoul.format(item.startDate) : "";
      if (!date || (from && date < from) || (to && date > to)) return false;
    }
    if (filter === "all") return true;
    if (filter === "attention") return item.attention.length > 0;
    if (filter === "unregistered_script") return !item.scriptPreparation.hasRegisteredScript;
    if (filter === "rehearsal_script") return !item.scriptPreparation.hasMaterial;
    return item.steps.some(step => step.key === filter && !step.done);
  });
  const ordered = matches.sort((a, b) => {
    const urgency = (item: typeof a) => item.startDate?.getTime() ?? Infinity;
    const exactTitle = Number(normalize(b.title) === term) - Number(normalize(a.title) === term);
    return exactTitle || Number(b.attention.length > 0) - Number(a.attention.length > 0) || urgency(a) - urgency(b);
  });
  return {
    query: query.trim(),
    scope,
    filter,
    from: from || null,
    to: to || null,
    total: matches.length,
    needsAttention: matches.filter(item => item.attention.length > 0).length,
    items: ordered.slice(0, 12).map(item => ({
      id: item.id, title: item.title, archived: item.archived, startDate: item.startDate ? dateInSeoul.format(item.startDate) : null,
      nextEventAt: item.nextEventAt?.toISOString() ?? null, venue: item.venue?.slice(0, 120) ?? null,
      readiness: item.steps.map(step => {
        if (step.key === "script" && !item.scriptPreparation.hasMaterial && step.done) {
          return { ...step, done: false, detail: "구성은 있지만 연습할 대본 없음" };
        }
        return step;
      }),
      casting: item.casting, attention: item.attention
    }))
  };
}

@Injectable()
export class ProductionAssistantService {
  constructor(private readonly ops: AdminOpsService, private readonly schedules: AssistantScheduleService) {}

  async ask(question: string, user: RequestUser, signal: AbortSignal, eventId?: string, previousRequest?: string) {
    if (user.platformRole !== PlatformRole.SUPER_ADMIN) throw new ForbiddenException("운영 관리자만 사용할 수 있어요.");
    let snapshot: Promise<ProductionSnapshot> | undefined;
    let evidence: ReturnType<typeof summarize> | null = null;
    const focusedEvent = eventId ? await this.schedules.getFocusedEvent(eventId, user) : null;
    const schedule: { focus: ScheduleMatch | null; matches: ScheduleMatch[]; hasMore: boolean; preview: SchedulePreview | null } =
      { focus: focusedEvent, matches: [], hasMore: false, preview: null };
    let lookedUpSchedule = false;
    let scheduleProblem = "";
    const modelEvent = ({ title, productionTitle, startAt, endAt }: ScheduleMatch) => ({ title, productionTitle, startAt, endAt });
    const result = await runResponses({
      skill: "production-operations", signal, schema: answerSchema, parse: parseAnswer,
      input: { question, previousRequest, today: dateInSeoul.format(new Date()), timezone: "Asia/Seoul",
        focusedEvent: focusedEvent ? { ref: "selected", ...modelEvent(focusedEvent) } : null },
      tools: [{
        name: "list_production_readiness",
        description: "Look up saved performance readiness and the next scheduled event for each performance. Filters apply to all saved performances before the first 12 matches are returned. Use for factual questions about existing performances.",
        properties: {
          query: { type: "string", description: "Distinctive words from the performance title, or an empty string.", maxLength: 120 },
          scope: { type: "string", description: "active (default), archived, or all.", maxLength: 8, enum: scopes },
          filter: { type: "string", description: "unregistered_script: no script has been registered (대본이 없는 공연). rehearsal_script: rehearsal material is not ready, including scripts not yet arranged into scenes. schedule: no next event. cues: no cues. attention: any preparation incomplete. all: no readiness filter.", maxLength: 24, enum: filters },
          from: { type: "string", description: "Inclusive start date of the performance itself, YYYY-MM-DD, or empty.", maxLength: 10 },
          to: { type: "string", description: "Inclusive end of the performance date filter, YYYY-MM-DD, or empty.", maxLength: 10 }
        },
        execute: async ({ query, scope, filter, from, to }) => {
          if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) {
            return { error: "invalid_filters" };
          }
          snapshot ??= this.ops.overview();
          const data = summarize(await snapshot, query, scope, filter as ReadinessFilter, from, to);
          evidence = data;
          const { items, ...counts } = data;
          return { ...counts, shown: items.length, items: items.map(({ id: _id, ...item }) => item) };
        }
      }, {
        name: "find_schedule_events",
        description: "Find existing events for a requested schedule change. Filter by one or more clues about the original event. Results and references are valid only for this request.",
        properties: {
          productionQuery: { type: "string", description: "Distinctive literal words from the existing production title, or empty.", maxLength: 120 },
          eventQuery: { type: "string", description: "Distinctive literal words from the existing event title, or empty.", maxLength: 120 },
          onDate: { type: "string", description: "Original (not proposed) start date in Seoul, YYYY-MM-DD, or empty.", maxLength: 10 }
        },
        execute: async ({ productionQuery, eventQuery, onDate }) => {
          lookedUpSchedule = true;
          const production = productionQuery.trim();
          const event = eventQuery.trim();
          if ((!production && !event && !onDate) || (onDate && !isIsoDate(onDate))) return { error: "need_original_event_clue" };
          const found = await this.schedules.findEvents(production, event, onDate, user);
          schedule.matches = found.items;
          schedule.hasMore = found.hasMore;
          return { hasMore: found.hasMore, items: found.items.map((item, index) => ({ ref: `S${index + 1}`, ...modelEvent(item) })) };
        }
      }, {
        name: "preview_schedule_change",
        description: "Prepare a read-only review for an unambiguous existing event. The server renders times, conflicts and who must respond again. This tool never saves or sends notices.",
        properties: {
          eventRef: { type: "string", description: "S1 from a unique lookup, or selected when the request refers to the event explicitly selected in the UI.", maxLength: 8 },
          startAt: { type: "string", description: "New start in Seoul local time (YYYY-MM-DDTHH:mm), or empty to keep it.", maxLength: 16 },
          endAt: { type: "string", description: "New end in Seoul local time (YYYY-MM-DDTHH:mm), or empty. If only the start is given, preserve duration.", maxLength: 16 }
        },
        execute: async ({ eventRef, startAt, endAt }) => {
          lookedUpSchedule = true;
          if (schedule.preview) return { error: "review_already_prepared" };
          const event = eventRef === "selected" ? focusedEvent :
            eventRef === "S1" && !schedule.hasMore && schedule.matches.length === 1 ? schedule.matches[0] : null;
          if (!event) return { error: "select_one_event_first" };
          const start = seoulScheduleTime(startAt);
          const end = seoulScheduleTime(endAt);
          if (start === null || end === null || (!start && !end)) return { error: "invalid_time" };
          try {
            schedule.preview = await this.schedules.preview(event.productionId, event.id, start, end, user);
          } catch (error) {
            if (!(error instanceof BadRequestException)) throw error;
            scheduleProblem = error.message;
            return { error: "invalid_time_range" };
          }
          schedule.focus = schedule.preview.event;
          return { status: !schedule.preview.timeChanged ? "unchanged" : schedule.preview.conflicts.length ? "has_conflicts" : "awaiting_confirmation" };
        }
      }]
    });
    const reviewRequested = Boolean(focusedEvent && result.value.reviewRequested && !lookedUpSchedule);
    if (lookedUpSchedule || result.value.scheduleQuestion || reviewRequested) {
      const { preview, matches, hasMore } = schedule;
      if (!schedule.focus && matches.length === 1 && !hasMore) schedule.focus = matches[0];
      const requiresSelection = !preview && (hasMore || matches.length > 1);
      let answer = scheduleProblem || result.value.answer;
      if (reviewRequested) answer = "화면 아래에서 변경 내용을 확인하고 저장 버튼을 눌러 주세요.";
      if (requiresSelection) answer = "바꿀 일정을 골라 주세요.";
      if (preview) {
        answer = !preview.timeChanged ? "현재 일정과 같은 시간이에요. 바꿀 시간을 알려 주세요."
          : preview.conflicts.length ? "겹치는 일정이 있어요. 아래 시간을 보고 다른 시간을 알려 주세요."
          : "바뀌는 시간과 다시 응답할 사람을 확인해 주세요.";
      }
      return { answer, draft: null, evidence: null, schedule: { ...schedule, reviewRequested }, run: result.run };
    }
    const draft = result.value.draft;
    if (draft && !normalize(question).includes(normalize(draft.title))) {
      return { answer: "등록할 공연 이름을 알려 주세요.", draft: null, evidence, run: result.run };
    }
    if (!draft && !evidence) {
      return { answer: "준비 상태를 확인할 공연 이름이나 새로 등록할 공연 이름을 알려 주세요.", draft: null, evidence, run: result.run };
    }
    return { ...result.value, evidence, run: result.run };
  }
}
