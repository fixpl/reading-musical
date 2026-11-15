import { decodeUploadName } from "./ai.service";

describe("decodeUploadName", () => {
  const mangled = (name: string) => Buffer.from(name, "utf8").toString("latin1");
  test("restores Korean names that multer read as latin1", () => {
    expect(decodeUploadName(mangled("따뜻한 것들의 무게.docx"))).toBe("따뜻한 것들의 무게.docx");
  });
  test("converts macOS decomposed Hangul to composed form", () => {
    expect(decodeUploadName(mangled("따뜻한.docx".normalize("NFD")))).toBe("따뜻한.docx");
  });
  test("keeps already-correct and ASCII names", () => {
    expect(decodeUploadName("대본.docx")).toBe("대본.docx");
    expect(decodeUploadName("script v2.txt")).toBe("script v2.txt");
    expect(decodeUploadName("café.txt")).toBe("café.txt");
  });
});
