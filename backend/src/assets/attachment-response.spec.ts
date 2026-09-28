import { attachmentDisposition } from "./attachment-response";

describe("original attachment response headers", () => {
  test("retains Korean original filenames without raw non-ASCII header values", () => {
    const header = attachmentDisposition({ fileName: "1장 요나와 함께 악보.pdf", storageKey: "scripts/file", mime: "application/pdf" }, false);
    expect(header.startsWith("inline;")).toBe(true);
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toBe("1장 요나와 함께 악보.pdf");
    expect(header).toMatch(/^[\x20-\x7E]+$/);
  });
  test("allows explicit download and forces non-preview documents to download", () => {
    expect(attachmentDisposition({ fileName: "악보.pdf", storageKey: "scripts/file", mime: "application/pdf" }, true).startsWith("attachment;")).toBe(true);
    expect(attachmentDisposition({ fileName: "대본.docx", storageKey: "scripts/file", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, false).startsWith("attachment;")).toBe(true);
    expect(attachmentDisposition({ fileName: "a.html", storageKey: "file", mime: "text/html" }, false).startsWith("attachment;")).toBe(true);
  });
  test("does not allow header injection and tolerates malformed Unicode filenames", () => {
    const header = attachmentDisposition({ fileName: 'x\r\nInjected: yes/\\"\uD800.pdf', storageKey: "file", mime: "application/pdf" }, false);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''");
  });
});
