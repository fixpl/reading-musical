import { projectProfileDetails } from "./profile-projector";

describe("공연팀 프로필 최소 공개", () => {
  test("일반 동료에게 프로필 JSON을 공개하지 않는다", () => {
    expect(projectProfileDetails({ specialties: ["안무"], voiceRange: "소프라노", address: "비공개 주소" }, false)).toBeNull();
  });

  test("권한이 있어도 폼의 직무 필드 외 임의 JSON과 개인 설정은 버린다", () => {
    const source = { specialties: ["연기", { phone: "비공개 전화" }, "안무", 1], voiceRange: "A3-C5",
      address: "비공개 주소", phone: "비공개 전화", settings: { emailNotify: false }, internalNote: "비공개 메모" };
    expect(projectProfileDetails(source, true)).toEqual({ specialties: ["연기", "안무"], voiceRange: "A3-C5" });
    expect(source.specialties).toHaveLength(4);
  });

  test.each([null, [], "private", { specialties: [null, {}], voiceRange: " " }])("공유 가능한 값이 없는 입력은 null을 반환한다", (value) => {
    expect(projectProfileDetails(value, true)).toBeNull();
  });
});
