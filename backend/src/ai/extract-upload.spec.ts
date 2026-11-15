import { BadRequestException } from "@nestjs/common";
import { PlatformRole } from "@prisma/client";
import { AiService, MAX_EXTRACTED_TEXT_CHARS } from "./ai.service";

const admin = { id: "u1", email: "a@b.c", platformRole: PlatformRole.SUPER_ADMIN } as never;
const txt = (text: string) => ({ buffer: Buffer.from(text, "utf8"), originalname: "script.txt", mimetype: "text/plain", size: text.length });

describe("AiService.extractTextFromUpload", () => {
  const service = new AiService({} as never);

  test("returns normal text", async () => {
    const result = await service.extractTextFromUpload("p1", admin, txt("안녕하세요 대본 텍스트입니다."));
    expect(result.chars).toBe(result.text.length);
  });

  test("accepts text at the limit", async () => {
    const result = await service.extractTextFromUpload("p1", admin, txt("가".repeat(MAX_EXTRACTED_TEXT_CHARS)));
    expect(result.chars).toBe(MAX_EXTRACTED_TEXT_CHARS);
  });

  test("rejects text over the limit with 400", async () => {
    const promise = service.extractTextFromUpload("p1", admin, txt("가".repeat(MAX_EXTRACTED_TEXT_CHARS + 1)));
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow("문서가 너무 길어요");
  });
});
