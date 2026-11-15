import { normalizeRecruitmentDocument, recruitmentText } from "./recruitment-document";
import type { RoundDocumentDto } from "./dto";

function document(extra: Record<string, unknown> = {}): RoundDocumentDto {
  return { title: "배우 모집", summary: "한 줄 소개", description: "모집 설명", region: "서울", conditions: "참여 조건",
    activityStartDate: "2028-02-29", activityEndDate: "2028-03-01", deadlineAt: "2028-02-28T15:00:00.000Z",
    positions: [{ role: "ACTOR", label: "배우", capacity: 2 }], ...extra } as RoundDocumentDto;
}

describe("모집 문서 정규화", () => {
  test("윤년 활동일은 UTC 자정 Date로, 시간대가 있는 마감은 같은 절대 시각으로 저장한다", () => {
    const result = normalizeRecruitmentDocument(document({ deadlineAt: "2028-02-29T00:00:00+09:00" }));
    expect(result.fields.activityStartDate?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(result.fields.deadlineAt?.toISOString()).toBe("2028-02-28T15:00:00.000Z");
  });

  test.each([
    [{ activityStartDate: "2027-02-29" }, "실제 활동 날짜를 확인해 주세요"],
    [{ activityStartDate: "2028-02-30" }, "실제 활동 날짜를 확인해 주세요"],
    [{ activityEndDate: "2028-02-28" }, "활동 종료일은 시작일보다 빠를 수 없어요"],
    [{ deadlineAt: "2028-02-29T00:00:00" }, "지원 마감 시각을 시간대가 포함된 시각으로 입력해 주세요"],
    [{ deadlineAt: "2028-02-30T00:00:00+09:00" }, "실제 활동 날짜를 확인해 주세요"],
    [{ deadlineAt: "2028-02-29T24:00:00Z" }, "실제 지원 마감 시각을 확인해 주세요"],
    [{ deadlineAt: "2028-02-29T23:60:00Z" }, "실제 지원 마감 시각을 확인해 주세요"],
    [{ deadlineAt: "2028-02-29T23:59:60Z" }, "실제 지원 마감 시각을 확인해 주세요"]
  ])("날짜·마감 경계의 기존 오류 계약을 유지한다: %j", (input, message) => {
    expect(() => normalizeRecruitmentDocument(document(input))).toThrow(message);
  });

  test("미정 날짜와 마감은 null로 유지하고 문서·자리의 알 수 없는 필드는 제거한다", () => {
    const result = normalizeRecruitmentDocument(document({ activityStartDate: "", activityEndDate: undefined, deadlineAt: null,
      organizationId: "ignored-org", status: "OPEN", createdById: "ignored-user",
      positions: [{ role: "STAFF", label: " 조명 ", capacity: 3, grantedById: "ignored-user", order: 999 }] }));
    expect(result.fields).toEqual({ title: "배우 모집", summary: "한 줄 소개", description: "모집 설명", region: "서울",
      conditions: "참여 조건", activityStartDate: null, activityEndDate: null, deadlineAt: null });
    expect(result.positions).toEqual([{ role: "STAFF", label: "조명", capacity: 3, order: 0 }]);
  });

  test("CRLF·CR은 LF로 정리하되 본문 줄바꿈과 탭은 보존한다", () => {
    expect(recruitmentText(" \r\n첫 줄\r\n둘째 줄\r셋째\t줄 \n", 100, "지원 내용", true)).toBe("첫 줄\n둘째 줄\n셋째\t줄");
  });

  test.each(["본문\u0000내용", "본문\u000b내용", "본문\u001f내용"])("제어 문자는 길이 오류와 같은 기존 안내로 거절한다", value => {
    expect(() => recruitmentText(value, 20, "지원 내용", true)).toThrow("지원 내용은 1자 이상 20자 이하로 입력해 주세요");
  });
});
