import { AdminOpsService, mailConfiguration } from "./admin-ops.service";

function fixture(sections: unknown[], backgroundAssetId: string | null = null, roles: unknown[] = [], scriptCount = 0) {
  const prisma = {
    production: { findMany: jest.fn().mockResolvedValue([{ id: "show", title: "공연", backgroundAssetId }]) },
    performanceSection: { findMany: jest.fn().mockResolvedValue(sections) },
    membership: { groupBy: jest.fn().mockResolvedValue([{ productionId: "show", _count: { _all: 2 } }]) },
    script: { groupBy: jest.fn().mockResolvedValue(scriptCount ? [{ productionId: "show", _count: { _all: scriptCount } }] : []) },
    trackCue: { groupBy: jest.fn().mockResolvedValue([]) },
    scheduleEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    activityLog: { groupBy: jest.fn().mockResolvedValue([]) },
    role: { findMany: jest.fn().mockResolvedValue(roles) }
  };
  return new AdminOpsService(prisma as never);
}
const section = (id: string, parentId: string | null, backgroundMode: string, connected = false) => ({ id, parentId, productionId: "show", backgroundMode, media: connected ? [{ asset: { kind: "VIDEO" } }] : [] });

test("manual leaf sections count; inherited background counts; partial media remains incomplete", async () => {
  const service = fixture([section("parent", null, "OWN", true), section("inherited", "parent", "INHERIT"), section("manual", null, "OWN"), section("no-video-needed", null, "NONE")]);
  const { items } = await service.overview();
  expect(items[0].steps.find(step => step.key === "script")).toMatchObject({ done: true, detail: "장면 3개" });
  expect(items[0].steps.find(step => step.key === "video")).toMatchObject({ done: false, detail: "1/2개 장면" });
  expect(items[0].attention).toContain("영상·배경 연결이 필요한 장면이 1개 있습니다.");
  expect(items[0].attention).toContain("담당 행동 큐가 등록되지 않았습니다.");
});
test("explicit background NONE is complete without adding imaginary missing videos", async () => {
  const { items } = await fixture([section("scene", null, "NONE")]).overview();
  expect(items[0].steps.find(step => step.key === "video")).toMatchObject({ done: true, detail: "해당 없음" });
});
test("production background satisfies inherited sections but not a missing OWN background", async () => {
  const { items } = await fixture([section("scene", null, "INHERIT"), section("own", null, "OWN")], "global-video").overview();
  expect(items[0].steps.find(step => step.key === "video")).toMatchObject({ done: false, detail: "1/2개 장면" });
});

test("casting reports assigned roles separately from the existing five registration steps", async () => {
  const rows = [
    { productionId: "show", _count: { assignments: 2 } },
    { productionId: "show", _count: { assignments: 0 } },
    { productionId: "another", _count: { assignments: 1 } }
  ];
  const partial = (await fixture([], null, rows).overview()).items[0];
  expect(partial.casting).toEqual({ done: false, detail: "1/2개 배역 배정" });
  expect(partial.steps).toHaveLength(5);
  const complete = (await fixture([], null, [rows[0]]).overview()).items[0];
  expect(complete.casting).toEqual({ done: true, detail: "1/1개 배역 배정" });
  expect((await fixture([]).overview()).items[0].casting).toEqual({ done: false, detail: "배역 없음" });
});

test("a placeholder scene or a director's note alone cannot mark the script as ready for rehearsal", async () => {
  const blank = { ...section("blank", null, "NONE"), scriptText: "  \n ※ 연출 메모", lyrics: "" };
  expect((await fixture([blank], null, [], 1).overview()).items[0].scriptPreparation)
    .toEqual({ hasMaterial: false, hasRegisteredScript: true, hasLinkedScene: false });
  expect((await fixture([{ ...blank, scriptText: "※ 연출 메모\n유리: 시작하겠습니다." }]).overview()).items[0].scriptPreparation)
    .toEqual({ hasMaterial: true, hasRegisteredScript: false, hasLinkedScene: false });
  expect((await fixture([{ ...blank, sourceSceneId: "linked" }], null, [], 1).overview()).items[0].scriptPreparation)
    .toEqual({ hasMaterial: false, hasRegisteredScript: true, hasLinkedScene: true });
});

test("Resend status uses its own sender and key rather than requiring an SMTP host", () => {
  expect(mailConfiguration({ MAIL_TRANSPORT: "resend", RESEND_FROM_EMAIL: "아트브릿지 <ops@example.test>", RESEND_API_KEY: "qa-key" }))
    .toEqual({ transport: "resend", from: "아트브릿지 <ops@example.test>", real: true });
  expect(mailConfiguration({ MAIL_TRANSPORT: "resend", RESEND_FROM_EMAIL: "ops@example.test" }).real).toBe(false);
  expect(mailConfiguration({ MAIL_TRANSPORT: "resend", MAIL_FROM: "ops@example.test", RESEND_API_KEY: "qa-key" }).real).toBe(false);
});
test("development json and local SMTP are distinguished from configured external SMTP", () => {
  expect(mailConfiguration({ MAIL_TRANSPORT: "json", MAIL_HOST: "smtp.example.test" }).real).toBe(false);
  expect(mailConfiguration({ MAIL_HOST: "localhost" }).real).toBe(false);
  expect(mailConfiguration({ MAIL_HOST: "::1" }).real).toBe(false);
  expect(mailConfiguration({ MAIL_HOST: "smtp.example.test" }).real).toBe(true);
});

test("system health reports paused mail even when the provider credentials are configured", () => {
  expect(mailConfiguration({
    MAIL_TRANSPORT: "resend",
    MAIL_SENDING_ENABLED: "false",
    RESEND_FROM_EMAIL: "ops@example.test",
    RESEND_API_KEY: "qa-key"
  })).toMatchObject({ transport: "resend", real: false, reason: "PAUSED" });
});
