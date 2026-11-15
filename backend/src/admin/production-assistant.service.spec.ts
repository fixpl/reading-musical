import { PlatformRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { runResponses } from "../ai/harness/responses-harness";
import type { AdminOpsService } from "./admin-ops.service";
import type { AssistantScheduleService } from "./assistant-schedule.service";
import { ProductionAssistantService } from "./production-assistant.service";

jest.mock("../ai/harness/responses-harness");

const admin: RequestUser = { id: "test", email: "admin@test.invalid", name: "관리자", platformRole: PlatformRole.SUPER_ADMIN };
const run = { id: "test-run", model: "gpt-6.1-terra", skill: "production-operations" as const, calls: ["list_production_readiness"] };

function show(title: string, registered: boolean, ready: boolean) {
  return {
    id: title, title, archived: false, startDate: null, nextEventAt: null,
    scriptPreparation: { hasRegisteredScript: registered, hasMaterial: ready, hasLinkedScene: ready },
    steps: [{ key: "script", label: "대본·구성", detail: ready ? "장면 1개" : registered ? "구성 전" : "대본 없음", done: ready }],
    casting: { done: false, detail: "배역 없음" }, attention: ready ? [] : ["대본 또는 구성을 확인해 주세요."]
  };
}

test("an unregistered-script query excludes existing but unarranged scripts", async () => {
  const overview = jest.fn().mockResolvedValue({ items: [show("대본 없음", false, false), show("구성 전", true, false), show("준비됨", true, true)] });
  const assistant = new ProductionAssistantService({ overview } as unknown as AdminOpsService, {} as AssistantScheduleService);
  jest.mocked(runResponses).mockImplementationOnce(async options => {
    const evidence = await options.tools[0].execute({ query: "", scope: "active", filter: "unregistered_script", from: "", to: "" }, new AbortController().signal);
    expect(evidence).toMatchObject({ total: 1, items: [{ title: "대본 없음" }] });
    return { value: options.parse('{"answer":"대본을 등록해 주세요.","draft":null}'), run };
  });
  const result = await assistant.ask("대본이 없는 공연만 알려줘", admin, new AbortController().signal);
  expect(result.evidence).toMatchObject({ filter: "unregistered_script", total: 1, items: [{ title: "대본 없음" }] });
  expect(overview).toHaveBeenCalledTimes(1);
});

const rehearsal = {
  id: "event-1", title: "최종 연습", productionId: "show-1", productionTitle: "달빛 우체국",
  startAt: new Date("2026-11-27T08:00:00Z"), endAt: new Date("2026-11-27T09:30:00Z")
};

test("schedule tools require a single event or explicit selection and reject invalid local times", async () => {
  const findEvents = jest.fn().mockResolvedValue({ items: [rehearsal, { ...rehearsal, id: "event-2" }], hasMore: false });
  const preview = jest.fn();
  const assistant = new ProductionAssistantService({} as AdminOpsService, { findEvents, preview } as unknown as AssistantScheduleService);
  const { signal } = new AbortController();
  jest.mocked(runResponses).mockImplementationOnce(async options => {
    const find = options.tools.find(tool => tool.name === "find_schedule_events")!;
    const prepare = options.tools.find(tool => tool.name === "preview_schedule_change")!;
    await find.execute({ productionQuery: "달빛 우체국", eventQuery: "최종 연습", onDate: "" }, signal);
    await expect(prepare.execute({ eventRef: "S1", startAt: "2026-11-27T19:00", endAt: "" }, signal))
      .resolves.toEqual({ error: "select_one_event_first" });
    return { value: options.parse('{"answer":"일정 후보예요.","draft":null,"scheduleQuestion":true}'), run };
  });
  const ambiguous = await assistant.ask("최종 연습을 저녁 7시로 바꿔 줘", admin, signal);
  expect(ambiguous).toMatchObject({ schedule: { matches: [{ id: "event-1" }, { id: "event-2" }], preview: null } });
  expect(preview).not.toHaveBeenCalled();

  const getFocusedEvent = jest.fn().mockResolvedValue(rehearsal);
  const selected = new ProductionAssistantService({} as AdminOpsService, { preview, getFocusedEvent } as unknown as AssistantScheduleService);
  preview.mockResolvedValue({ event: rehearsal, timeChanged: true, conflicts: [], approvalToken: "for-operator-only", reconfirm: [{ name: "배우" }] });
  jest.mocked(runResponses).mockImplementationOnce(async options => {
    const prepare = options.tools.find(tool => tool.name === "preview_schedule_change")!;
    expect(options.tools.map(tool => tool.name)).toEqual(["list_production_readiness", "find_schedule_events", "preview_schedule_change"]);
    await expect(prepare.execute({ eventRef: "selected", startAt: "2026-11-31T19:00", endAt: "" }, signal))
      .resolves.toEqual({ error: "invalid_time" });
    await expect(prepare.execute({ eventRef: "selected", startAt: "2026-11-27T19:30", endAt: "" }, signal))
      .resolves.toEqual({ status: "awaiting_confirmation" });
    return { value: options.parse('{"answer":"변경할 시간이에요.","draft":null,"scheduleQuestion":true}'), run };
  });
  const result = await selected.ask("그럼 저녁 7시 반으로", admin, signal, rehearsal.id);
  expect(preview).toHaveBeenCalledTimes(1);
  expect(preview).toHaveBeenCalledWith(rehearsal.productionId, rehearsal.id, "2026-11-27T19:30:00+09:00", "", admin);
  expect(result).toMatchObject({ schedule: { preview: { approvalToken: "for-operator-only", reconfirm: [{ name: "배우" }] } } });
});
