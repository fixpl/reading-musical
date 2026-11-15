import type { RecruitmentApplicationStatus, RecruitmentRoundStatus } from "@prisma/client";
import { isRecruitmentApplicationPending, isRecruitmentOpen, presentRecruitmentApplication, presentRecruitmentRound } from "./recruitment-presenter";

const deadline = new Date("2028-02-28T15:00:00.000Z");
const position = { id: "position", role: "ACTOR" as const, label: "주연", capacity: 2, _count: { applications: 1 }, roundId: "private-round" };
function round(status: RecruitmentRoundStatus = "OPEN") {
  return { id: "round", productionId: "production", production: { title: "공연", organizationId: "private-org" },
    title: "모집", summary: "소개", description: "설명", region: "서울", conditions: "조건",
    activityStartDate: new Date("2028-02-29T00:00:00.000Z"), activityEndDate: null, deadlineAt: deadline,
    status, revision: 1, createdAt: new Date("2028-02-01T00:00:00.000Z"), publishedAt: null, positions: [position],
    createdById: "private-manager", internalNote: "private-note" };
}

describe("모집 응답과 마감 표시", () => {
  test.each([
    [new Date(deadline.getTime() - 1), true, "OPEN"],
    [deadline, false, "CLOSED"],
    [new Date(deadline.getTime() + 1), false, "CLOSED"]
  ])("마감 직전·동일·직후 지원 가능 여부와 화면 상태를 일치시킨다: %s", (now, open, status) => {
    expect(isRecruitmentOpen(round(), now)).toBe(open);
    expect(presentRecruitmentRound(round(), now).effectiveStatus).toBe(status);
  });

  test.each(["DRAFT", "CLOSED", "CANCELLED"] as const)("마감 전이어도 %s는 지원받지 않는다", status => {
    const now = new Date(deadline.getTime() - 1);
    expect(isRecruitmentOpen(round(status), now)).toBe(false);
    expect(presentRecruitmentRound(round(status), now).effectiveStatus).toBe(status);
  });

  test("마감이 없는 OPEN은 시각과 관계없이 접수 중이다", () => {
    const row = { ...round(), deadlineAt: null };
    expect(isRecruitmentOpen(row, new Date("2099-12-31T23:59:59.999Z"))).toBe(true);
    expect(presentRecruitmentRound(row, deadline).deadlineAt).toBeNull();
  });

  test.each([
    ["SUBMITTED", true], ["REVIEWING", true], ["ON_HOLD", true], ["APPROVED", false],
    ["NOT_SELECTED", false], ["WITHDRAWN", false], ["CANCELLED", false]
  ] as Array<[RecruitmentApplicationStatus, boolean]>)("미처리 상태 %s의 취소·심사 가능 범위를 보존한다", (status, pending) => {
    expect(isRecruitmentApplicationPending(status)).toBe(pending);
  });

  test("지원 응답은 연락처·조직·심사자 정보를 제거하고 null·날짜 형식을 유지한다", () => {
    const application = { id: "application", roundId: "round", positionId: "position", userId: "applicant",
      user: { name: "지원자", email: "private@example.test", profileDetails: { privateNote: "hidden" } },
      status: "APPROVED" as const, revision: 2, message: "지원 내용", availability: "가능 일정", reviewMessage: null, membershipId: null,
      createdAt: deadline, updatedAt: deadline, position, round: round(), reviewedById: "private-reviewer", reviewedAt: deadline,
      events: [{ id: "event", fromStatus: "SUBMITTED" as const, toStatus: "APPROVED" as const, message: null, createdAt: deadline, actorId: "private-reviewer" }] };
    const output = presentRecruitmentApplication(application, deadline);
    expect(output).toMatchObject({ applicantName: "지원자", reviewMessage: null, membershipId: null,
      createdAt: "2028-02-28T15:00:00.000Z", updatedAt: "2028-02-28T15:00:00.000Z",
      round: { activityStartDate: "2028-02-29", activityEndDate: null, publishedAt: null, status: "OPEN", effectiveStatus: "CLOSED" },
      position: { id: "position", role: "ACTOR", label: "주연", capacity: 2, approvedCount: 1 } });
    expect(output.events).toEqual([{ id: "event", fromStatus: "SUBMITTED", toStatus: "APPROVED", message: null, createdAt: "2028-02-28T15:00:00.000Z" }]);
    const serialized = JSON.stringify(output);
    for (const key of ["email", "profileDetails", "organizationId", "createdById", "internalNote", "reviewedById", "reviewedAt", "actorId"]) expect(serialized).not.toContain(`"${key}"`);
    for (const value of ["private@example.test", "private-org", "private-reviewer", "private-note"]) expect(serialized).not.toContain(value);
  });
});
