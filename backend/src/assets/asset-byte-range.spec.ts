import { parseByteRange } from "./asset-byte-range";

describe("browser media byte ranges", () => {
  test("supports bounded, open-ended and suffix seeks and clamps the file end", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=90-200", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
  });
  test.each(["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=-", "bytes=0-1,5-6", "bytes=9007199254740993-", "items=0-1"])("rejects unsupported or unsatisfiable range %s", (range) => {
    expect(parseByteRange(range, 100)).toBe("unsatisfiable");
  });
  test("an empty object cannot satisfy a byte range", () => {
    expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});
