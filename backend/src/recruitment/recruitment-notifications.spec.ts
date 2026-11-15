import { NotificationsService } from "../notifications/notifications.service";

function fixture(href: string) {
  const create = jest.fn().mockResolvedValue({ id: "notification", userId: "applicant", productionId: "production", type: "RECRUITMENT_APPLICATION_UPDATED",
    payload: { title: "공연 참여가 확정됐어요", body: "배역은 별도로 확인해 주세요.", href },
    production: { id: "production", title: "공연 제목", currentPhase: "REHEARSAL" }, readAt: null, createdAt: new Date() });
  const service = new NotificationsService({ notification: { create } } as never, { emitNotificationCreated: jest.fn() } as never);
  return service;
}
describe("모집 인앱 알림 표시", () => {
  test("공연명과 지원 안내를 표시하고 새 타입은 공연 내부 단계를 포함하지 않는다", async () => {
    const result = await fixture("/app/p/production").createNotification({ userId: "applicant", productionId: "production", type: "RECRUITMENT_APPLICATION_UPDATED" });
    expect(result).toMatchObject({ title: "공연 제목 · 공연 참여가 확정됐어요", body: "배역은 별도로 확인해 주세요.", href: "/app/p/production", production: { id: "production", title: "공연 제목" } });
    expect(result.production).not.toHaveProperty("currentPhase");
  });
  test.each(["https://outside.invalid", "/app/p/other", "/admin/users", "//outside.invalid"])("지원 결과 알림이 임의 주소로 이동하지 않는다: %s", async href => {
    const result = await fixture(href).createNotification({ userId: "applicant", type: "RECRUITMENT_APPLICATION_UPDATED" });
    expect(result.href).toBe("/app/applications");
  });
});
