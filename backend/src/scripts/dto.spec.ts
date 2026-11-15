import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ApplyScriptImportDto, CreateActDto, CreateAnnotationDto, CreateBlockDto, CreateSceneDto, CreateScriptDto, CreateScriptImportDto, CreateScriptVersionDto, RestoreScriptVersionDto, ReviewedImportBlockDto, UpdateAnnotationDto, UpdateBlockDto } from "./dto";

type DtoClass = new () => object;
const cases: Array<[DtoClass, string, number]> = [
  [CreateScriptDto, "title", 200], [CreateScriptDto, "initialActTitle", 200], [CreateScriptDto, "initialSceneTitle", 200],
  [CreateActDto, "title", 200], [CreateActDto, "initialSceneTitle", 200],
  [CreateSceneDto, "title", 200], [CreateSceneDto, "summary", 5000],
  [CreateBlockDto, "text", 20000], [CreateBlockDto, "cueLabel", 100],
  [UpdateBlockDto, "text", 20000], [UpdateBlockDto, "cueLabel", 100],
  [CreateScriptVersionDto, "label", 100], [RestoreScriptVersionDto, "backupLabel", 100],
  [CreateScriptImportDto, "rawText", 200000],
  [ReviewedImportBlockDto, "tempId", 100], [ReviewedImportBlockDto, "text", 20000],
  [ReviewedImportBlockDto, "speakerName", 100], [ReviewedImportBlockDto, "actTitle", 200], [ReviewedImportBlockDto, "sceneTitle", 200],
  [ApplyScriptImportDto, "versionName", 100],
  [CreateAnnotationDto, "content", 5000], [UpdateAnnotationDto, "content", 5000]
];

test.each(cases)("%p.%s rejects overlong and whitespace-only values", (Dto, field, limit) => {
  const errorsFor = (text: string) => validateSync(Object.assign(new Dto(), { [field]: text })).find((error) => error.property === field);
  expect(errorsFor("가".repeat(limit + 1))?.constraints).toHaveProperty("maxLength");
  expect(errorsFor(" \n\t ")?.constraints).toHaveProperty("matches");
  expect(errorsFor("\n")?.constraints).toHaveProperty("matches");
  expect(errorsFor("가".repeat(limit))).toBeUndefined();
});

test("optional empty values still clear labels or select existing fallback defaults", () => {
  const values = [
    new CreateScriptDto(), new CreateActDto(), new CreateSceneDto(), new CreateBlockDto(), new UpdateBlockDto(),
    new RestoreScriptVersionDto(), new CreateScriptImportDto(), new ReviewedImportBlockDto(), new ApplyScriptImportDto()
  ];
  const optionalFields = [
    ["initialActTitle", "initialSceneTitle"], ["initialSceneTitle"], ["summary"], ["cueLabel"], ["cueLabel"],
    ["backupLabel"], ["rawText"], ["speakerName", "actTitle", "sceneTitle"], ["versionName"]
  ];
  values.forEach((value, index) => {
    optionalFields[index].forEach((field) => Object.assign(value, { [field]: "" }));
    expect(validateSync(value).filter((error) => optionalFields[index].includes(error.property))).toEqual([]);
  });
  expect(validateSync(Object.assign(new UpdateBlockDto(), { cueLabel: null }))).toEqual([]);
});

test("validation does not trim meaningful spaces or line breaks from a script body", () => {
  const text = "  민지: 첫 줄\n\n    다음 줄  ";
  const dto = plainToInstance(CreateBlockDto, { type: "DIALOGUE", text });
  expect(validateSync(dto)).toEqual([]);
  expect(dto.text).toBe(text);
});
