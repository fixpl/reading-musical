import { normalizeShowcaseDocument, showcaseText } from "./showcase-document";

function document(extra: Record<string, unknown> = {}) {
  return { title: "공연 소개", synopsis: "한 줄 소개", description: "관객용 설명", venue: "소극장", startDate: "2028-02-29", endDate: null,
    posterAssetId: null, officialUrl: "", ticketUrl: "", videoUrl: "", gallery: [], ...extra };
}
function image(index: number) { return { assetId: `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, caption: "사진 설명" }; }

describe("관객용 공연 문서 정규화", () => {
  test("공연 날짜는 시각으로 바꾸지 않고 연월일 문자열 또는 null을 유지한다", () => {
    expect(normalizeShowcaseDocument(document({ endDate: "" }))).toMatchObject({ startDate: "2028-02-29", endDate: null });
    expect(normalizeShowcaseDocument(document({ startDate: undefined }))).toMatchObject({ startDate: null });
  });

  test.each([
    [{ startDate: "2027-02-29" }, "실제 공연 날짜를 확인해 주세요"],
    [{ startDate: "2028-02-30" }, "실제 공연 날짜를 확인해 주세요"],
    [{ startDate: "2028-02-29T00:00:00Z" }, "공연 날짜는 연월일로 입력해 주세요"],
    [{ endDate: "2028-02-28" }, "종료일은 시작일보다 빠를 수 없어요"]
  ])("관객용 날짜의 기존 오류 계약을 유지한다: %j", (input, message) => {
    expect(() => normalizeShowcaseDocument(document(input))).toThrow(message);
  });

  test.each([
    "http://example.test", "https://user@example.test", "https://user:password@example.test",
    "javascript:alert(1)", "//example.test/path"
  ])("userinfo 또는 HTTPS 이외 주소를 거절한다: %s", officialUrl => {
    expect(() => normalizeShowcaseDocument(document({ officialUrl }))).toThrow("https://로 시작하는 공개 주소를 입력해 주세요");
  });

  test("공개 HTTPS 주소를 정규화하고 비어 있는 링크는 유지한다", () => {
    expect(normalizeShowcaseDocument(document({ officialUrl: "  https://EXAMPLE.test:443/소개?q=1  " }))).toMatchObject({
      officialUrl: "https://example.test/%EC%86%8C%EA%B0%9C?q=1", ticketUrl: "", videoUrl: ""
    });
  });

  test("갤러리는 최대 8장과 입력 순서를 유지하고 9장과 중복은 거절한다", () => {
    const gallery = Array.from({ length: 8 }, (_, index) => image(index));
    expect(normalizeShowcaseDocument(document({ gallery })).gallery).toEqual(gallery);
    expect(() => normalizeShowcaseDocument(document({ gallery: [...gallery, image(8)] }))).toThrow("홍보 사진은 최대 8장까지 등록할 수 있어요");
    expect(() => normalizeShowcaseDocument(document({ gallery: [image(0), image(0)] }))).toThrow("같은 홍보 사진을 중복 등록할 수 없어요");
  });

  test("문서·사진의 추가 필드는 공개 스냅샷에 복사하지 않는다", () => {
    const output = normalizeShowcaseDocument(document({ internalNote: "private", publishedById: "manager", gallery: [{ ...image(0), ownerId: "owner", storageKey: "private/object" }] }));
    expect(Object.keys(output).sort()).toEqual(["title", "synopsis", "description", "venue", "startDate", "endDate", "posterAssetId", "officialUrl", "ticketUrl", "videoUrl", "gallery"].sort());
    expect(output.gallery).toEqual([image(0)]);
    expect(JSON.stringify(output)).not.toContain("private");
  });

  test("CRLF·CR은 LF로 정리하고 제어 문자는 별도의 기존 안내로 거절한다", () => {
    expect(showcaseText(" 첫 줄\r\n둘째\r셋째\t줄 ", 100, "공연 설명")).toBe("첫 줄\n둘째\n셋째\t줄");
    expect(() => showcaseText("설명\u0000본문", 100, "공연 설명")).toThrow("공연 설명에 사용할 수 없는 문자가 있어요");
  });
});
