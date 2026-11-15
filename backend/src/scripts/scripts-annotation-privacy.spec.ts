import "reflect-metadata";
import { ScriptEntityLookupService } from "./script-entity-lookup.service";
import { ScriptSnapshotService } from "./script-snapshot.service";
import { ScriptsService } from "./scripts.service";
import type { RequestUser } from "../common/types/request-user";

const annotations = [
  { id: "mine", authorId: "viewer", isShared: false, content: "개인 연습 기록" },
  { id: "shared", authorId: "other", isShared: true, content: "팀 공지" },
  { id: "private", authorId: "other", isShared: false, content: "다른 작성자의 기록" }
];

describe("개인 대본 주석의 읽기 범위", () => {
  it.each(["SUPER_ADMIN", "ORG_ADMIN", "MEMBER"] as const)("%s도 타인의 비공개 주석을 받지 않는다", async (platformRole) => {
    const script = { id: "script", acts: [{ scenes: [{ blocks: [{ id: "block", annotations }] }] }] };
    const prisma = {
      script: { findFirst: jest.fn().mockResolvedValue(script) },
      sceneBlock: { findFirst: jest.fn().mockResolvedValue({ id: "block", sceneId: "scene" }) },
      annotation: { findMany: jest.fn().mockImplementation(async ({ where }) => annotations.filter(note =>
        !where.OR || where.OR.some((condition: { isShared?: boolean; authorId?: string }) =>
          condition.isShared === note.isShared || condition.authorId === note.authorId))) }
    };
    const service = new ScriptsService(prisma as never, new ScriptEntityLookupService(prisma as never), new ScriptSnapshotService(prisma as never), {} as never);
    jest.spyOn(service as never, "assertMembership").mockResolvedValue(undefined as never);
    jest.spyOn(service as never, "hasAnyRole").mockResolvedValue(true as never);
    const viewer: RequestUser = { id: "viewer", email: "viewer@example.test", name: "참여자", platformRole };

    const detail = await service.getScript("production", "script", viewer);
    expect(detail.acts[0].scenes[0].blocks[0].annotations).toEqual([annotations[0], annotations[1]]);
    expect((await service.listAnnotations("production", "block", viewer)).map(note => note.id)).toEqual(["mine", "shared"]);
    expect(script.acts[0].scenes[0].blocks[0].annotations).toHaveLength(3);
  });
});
