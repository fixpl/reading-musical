import "reflect-metadata";
import { createHash } from "node:crypto";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CREDIT_NOTICE_VERSION, SaveShowcaseDto, type ShowcaseDocument } from "./dto";
import { ShowcaseService } from "./showcase.service";
import type { RequestUser } from "../common/types/request-user";

const pid = "11111111-1111-4111-8111-111111111111";
const otherPid = "22222222-2222-4222-8222-222222222222";
const imageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherImageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const admin = { id: "admin", email: "admin@example.test", platformRole: "SUPER_ADMIN", name: "관리자" } as RequestUser;
const actor = { id: "actor", email: "private@example.test", platformRole: "MEMBER", name: "내부 이름" } as RequestUser;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 10, 20, 30]);
const fingerprint = createHash("sha256").update(png).digest("hex");
const document = (extra: Partial<ShowcaseDocument> = {}): ShowcaseDocument => ({
  title: "관객에게 보일 공연", synopsis: "한 줄 소개", description: "공연 소개 본문", venue: "소극장", startDate: "2026-12-01", endDate: "2026-12-03",
  posterAssetId: null, officialUrl: "", ticketUrl: "", videoUrl: "", gallery: [], ...extra
});

function fixture() {
  const production = { id: pid, organizationId: "org", title: "내부 공연", synopsis: "내부 소개", description: null, venue: null, startDate: null, endDate: null, archived: false, deletedAt: null as Date | null };
  let row: any = null;
  let membership: any = { id: "membership", userId: actor.id, productionId: pid, primaryRole: "ACTOR", roles: [{ role: "ACTOR" }],
    user: { id: actor.id, name: actor.name, status: "ACTIVE", profileType: "ACTOR", photoAssetId: imageId },
    production: { ...production, showcase: { publishedAt: new Date() } },
    castAssignments: [{ role: { name: "주인공", productionId: pid } }], creditConsent: null };
  const assetsById: Record<string, any> = { [imageId]: { id: imageId, productionId: pid, ownerId: "admin", kind: "IMAGE", mime: "image/png", storageKey: `showcase/${pid}/image.png`, sizeBytes: png.length, checksum: `sha256:${fingerprint}` } };
  const apply = (data: any, current: any) => Object.fromEntries(Object.entries(data).map(([key, value]: [string, any]) => [key, value && typeof value === "object" && "increment" in value ? current[key] + value.increment : value]));
  let tail: Promise<unknown> = Promise.resolve();
  const prisma: any = {
    $queryRaw: jest.fn().mockImplementation(async (query) => query[0].includes("SELECT s.production_id") ? row?.publishedAt && !production.deletedAt && !production.archived ? [{ productionId: pid }] : [] : [{ id: pid }]),
    $transaction: jest.fn((operation) => {
      // DB 행 잠금의 직렬 실행 순서를 흉내 낸다. 실제 PostgreSQL 잠금은 별도 통합 검증 대상이다.
      const pending = tail.then(() => operation(prisma)); tail = pending.catch(() => undefined); return pending;
    }),
    production: { findFirst: jest.fn().mockImplementation(async () => !production.deletedAt && !production.archived ? production : null) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "other-org" }) },
    membership: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where.roles) return null;
        return membership && membership.productionId === where.productionId && membership.creditConsent?.id === where.creditConsent?.id ? membership : null;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => membership && (!where.userId_productionId || where.userId_productionId.userId === membership.userId) ? membership : null),
      findMany: jest.fn().mockImplementation(async () => membership ? [membership] : [])
    },
    productionShowcase: {
      count: jest.fn().mockImplementation(async () => row?.publishedAt && !production.deletedAt && !production.archived ? 1 : 0),
      findUnique: jest.fn().mockImplementation(async () => row),
      findFirst: jest.fn().mockImplementation(async () => row?.publishedAt && !production.deletedAt && !production.archived ? row : null),
      findMany: jest.fn().mockImplementation(async () => row?.publishedAt && !production.deletedAt && !production.archived ? [row] : []),
      create: jest.fn().mockImplementation(async ({ data }: any) => row = { id: "showcase", revision: 1, published: null, publishedAt: null, ...data }),
      update: jest.fn().mockImplementation(async ({ data }: any) => row = { ...row, ...apply(data, row) })
    },
    performanceCreditConsent: {
      create: jest.fn().mockImplementation(async ({ data }: any) => membership.creditConsent = { id: "credit-id", revision: 1, ...data }),
      update: jest.fn().mockImplementation(async ({ data }: any) => membership.creditConsent = { ...membership.creditConsent, ...apply(data, membership.creditConsent) })
    },
    asset: {
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => assetsById[where.id] ?? null),
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        const asset = assetsById[where.id]; return asset && asset.ownerId === where.ownerId && asset.productionId === null ? asset : null;
      })
    }
  };
  const assets = { getSignedUrl: jest.fn().mockResolvedValue({ url: "https://private.invalid/temporary-signed-image" }), assertStoredObject: jest.fn().mockResolvedValue(undefined),
    isShowcaseImageStorageKey: jest.fn((key: string) => key.startsWith("showcase/")),
    readMockObject: jest.fn().mockResolvedValue({ body: png }) };
  const config = { get: (key: string) => ({ API_EXTERNAL_URL: "https://api.example.test", API_PREFIX: "/api/v1" }[key]) };
  const service = new ShowcaseService(prisma, assets as never, config as never);
  return { service, prisma, assets, production, assetsById, get row() { return row; }, set row(value: any) { row = value; }, get membership() { return membership; }, set membership(value: any) { membership = value; } };
}

async function savedAndPublished(f: ReturnType<typeof fixture>, draft = document()) {
  await f.service.save(pid, { expectedRevision: 0, draft }, admin);
  await f.service.publish(pid, 1, admin);
}
const credit = (overrides = {}) => ({ expectedRevision: 0, displayName: "공개 이름", showName: true, showPhoto: false, noticeVersion: CREDIT_NOTICE_VERSION, ...overrides });
async function photoCredit(f: ReturnType<typeof fixture>, overrides = {}) {
  const current = (await f.service.myCredits(actor)).items[0];
  return credit({ showPhoto: true, expectedPhotoToken: current?.photoToken ?? null, ...overrides });
}

// 검증은 공개본/개인정보 경계를 중심으로 한다. 테스트 전용 DB나 외부 저장소에 접속하지 않는다.
describe("공연 소개 공개 경계", () => {
  test("미작성 소개 조회는 기존 기본 정보를 채우되 저장하거나 게시하지 않는다", async () => {
    const f = fixture(); const editor = await f.service.editor(pid, admin);
    expect(editor).toMatchObject({ revision: 0, draft: { title: "내부 공연" }, published: null, publicPath: `/performances/${pid}` });
    expect(f.prisma.productionShowcase.create).not.toHaveBeenCalled();
    await expect(f.service.detailPublic(pid)).rejects.toMatchObject({ status: 404 });
  });
  test("운영용 PUBLISHED 여부를 읽지 않고 별도로 게시한 소개만 노출한다", async () => {
    const f = fixture(); await f.service.save(pid, { expectedRevision: 0, draft: document() }, admin);
    expect(await f.service.listPublic()).toMatchObject({ items: [], total: 0, hasMore: false, offset: 0 });
    await f.service.publish(pid, 1, admin);
    expect(await f.service.listPublic()).toMatchObject({ items: [{ title: "관객에게 보일 공연", slug: pid }] });
    expect(f.prisma.productionShowcase.findMany).toHaveBeenLastCalledWith({ where: { publishedAt: { not: null }, production: { deletedAt: null, archived: false }, productionId: { in: [pid] } } });
  });
  test("게시 후 초안을 고쳐도 기존 공개본은 그대로이며 다시 게시할 때 바뀐다", async () => {
    const f = fixture(); await savedAndPublished(f);
    await f.service.save(pid, { expectedRevision: 2, draft: document({ title: "수정 중인 초안" }) }, admin);
    expect((await f.service.editor(pid, admin)).hasDraftChanges).toBe(true);
    expect((await f.service.detailPublic(pid)).title).toBe("관객에게 보일 공연");
    await f.service.publish(pid, 3, admin);
    expect((await f.service.detailPublic(pid)).title).toBe("수정 중인 초안");
    expect((await f.service.editor(pid, admin)).hasDraftChanges).toBe(false);
  });
  test("같은 버전의 동시 저장 중 하나만 성공하고 다른 저장은 409이다", async () => {
    const f = fixture(); const result = await Promise.allSettled([
      f.service.save(pid, { expectedRevision: 0, draft: document({ title: "첫 저장" }) }, admin),
      f.service.save(pid, { expectedRevision: 0, draft: document({ title: "동시 저장" }) }, admin)
    ]);
    expect(result.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(result.find((entry) => entry.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect(f.row.revision).toBe(1);
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
  test("게시와 비공개도 기존 revision을 재사용하면 409이다", async () => {
    const f = fixture(); await savedAndPublished(f);
    await expect(f.service.publish(pid, 1, admin)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.unpublish(pid, 1, admin)).rejects.toMatchObject({ status: 409 });
    await f.service.unpublish(pid, 2, admin);
    expect((await f.service.editor(pid, admin)).draft.title).toBe("관객에게 보일 공연");
    await expect(f.service.detailPublic(pid)).rejects.toMatchObject({ status: 404 });
  });
  test.each(["deleted", "archived"])("%s 공연은 게시본이 있어도 목록·상세·미디어에 나오지 않는다", async (state) => {
    const f = fixture(); await savedAndPublished(f, document({ posterAssetId: imageId }));
    if (state === "deleted") f.production.deletedAt = new Date(); else f.production.archived = true;
    expect(await f.service.listPublic()).toMatchObject({ items: [], total: 0, hasMore: false, offset: 0 });
    await expect(f.service.detailPublic(pid)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.publicImage(pid, "poster")).rejects.toMatchObject({ status: 404 });
    expect(f.assets.readMockObject).toHaveBeenCalledTimes(2); // 초안/게시 검증 때만 읽었다.
  });
  test("다른 조직 ORG_ADMIN과 일반 배우는 소개를 저장/게시할 수 없다", async () => {
    const f = fixture(); const orgAdmin = { ...actor, platformRole: "ORG_ADMIN" } as RequestUser;
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document() }, orgAdmin)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.publish(pid, 0, actor)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.summaries(actor)).rejects.toMatchObject({ status: 403 });
    expect(f.prisma.productionShowcase.create).not.toHaveBeenCalled();
  });
  test("공연 제작자 또는 자기 조직 ORG_ADMIN은 소개를 관리한다", async () => {
    const f = fixture(); f.prisma.membership.findFirst.mockResolvedValue({ id: "producer-membership" });
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document() }, actor)).resolves.toMatchObject({ revision: 1 });
    f.prisma.user.findUnique.mockResolvedValue({ organizationId: "org" });
    await expect(f.service.editor(pid, { ...actor, platformRole: "ORG_ADMIN" })).resolves.toMatchObject({ revision: 1 });
  });
  test("제목 외 포스터·장소·공연 날짜를 비워서 게시할 수 있다", async () => {
    const f = fixture(); await savedAndPublished(f, document({ venue: "", startDate: null, endDate: null }));
    expect(await f.service.detailPublic(pid)).toMatchObject({ posterUrl: null, startDate: null, endDate: null, venue: "" });
  });
  test.each([
    { startDate: "2026-02-30" }, { endDate: "2026-11-30" }, { startDate: "2026-12-01T00:00:00Z" },
    { officialUrl: "javascript:alert(1)" }, { videoUrl: "http://example.test/video" }, { ticketUrl: "https://user:password@example.test" },
    { title: " " }, { synopsis: "a".repeat(201) }, { gallery: [{ assetId: imageId, caption: "" }, { assetId: imageId, caption: "중복" }] }
  ])("잘못된 날짜/주소/길이/중복 사진을 거절한다: %j", async (invalid) => {
    const f = fixture(); await expect(f.service.save(pid, { expectedRevision: 0, draft: document(invalid) }, admin)).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.productionShowcase.create).not.toHaveBeenCalled();
  });
  test("누락 draft와 추가 userId는 DTO 검증에서 거절한다", async () => {
    const missing = await validate(plainToInstance(SaveShowcaseDto, { expectedRevision: 0 }), { whitelist: true, forbidNonWhitelisted: true });
    expect(missing.some((error) => error.property === "draft")).toBe(true);
    const extra = await validate(plainToInstance(SaveShowcaseDto, { expectedRevision: 0, draft: document(), userId: actor.id }), { whitelist: true, forbidNonWhitelisted: true });
    expect(extra.some((error) => error.property === "userId")).toBe(true);
  });
});

describe("공개 이미지", () => {
  test("다른 공연의 사진과 연습용 사진을 홍보 이미지로 선택할 수 없다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = otherPid;
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document({ posterAssetId: imageId }) }, admin)).rejects.toMatchObject({ status: 400 });
    f.assetsById[imageId].productionId = pid; f.assetsById[imageId].storageKey = `cue-media/${pid}/image.png`;
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document({ posterAssetId: imageId }) }, admin)).rejects.toMatchObject({ status: 400 });
  });
  test("완료되지 않은 업로드는 초안 저장/게시 모두 거절한다", async () => {
    const f = fixture(); f.assets.assertStoredObject.mockRejectedValue(new Error("upload unfinished"));
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document({ posterAssetId: imageId }) }, admin)).rejects.toThrow("upload unfinished");
    expect(f.prisma.productionShowcase.create).not.toHaveBeenCalled();
  });
  test("실제 이미지가 아닌 본문과 다른 checksum은 거절한다", async () => {
    const f = fixture(); f.assets.readMockObject.mockResolvedValue({ body: Buffer.from("<svg></svg>") });
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document({ posterAssetId: imageId }) }, admin)).rejects.toMatchObject({ status: 400 });
    f.assets.readMockObject.mockResolvedValue({ body: Buffer.from([...png.subarray(0, 8), 90, 91, 92]) });
    await expect(f.service.save(pid, { expectedRevision: 0, draft: document({ posterAssetId: imageId }) }, admin)).rejects.toMatchObject({ status: 400 });
  });
  test("공개 응답은 서명 주소 대신 현재 게시 상태를 검사하는 proxy 주소만 준다", async () => {
    const f = fixture(); await savedAndPublished(f, document({ posterAssetId: imageId, gallery: [{ assetId: imageId, caption: "홍보 사진" }] }));
    const detail = await f.service.detailPublic(pid);
    expect(detail.posterUrl).toBe(`https://api.example.test/api/v1/public/performances/${pid}/poster`);
    expect(detail.gallery[0].url).toContain(`/public/performances/${pid}/gallery/0`);
    expect(JSON.stringify(detail)).not.toContain("temporary-signed-image");
    expect(JSON.stringify(detail)).not.toContain("posterAssetId");
    await expect(f.service.publicImage(pid, "poster")).resolves.toEqual({ body: png, mime: "image/png" });
    await f.service.unpublish(pid, 2, admin);
    await expect(f.service.publicImage(pid, "poster")).rejects.toMatchObject({ status: 404 });
  });
  test("음수와 범위 밖 gallery 인덱스로 다른 파일을 읽지 못한다", async () => {
    const f = fixture(); await savedAndPublished(f);
    await expect(f.service.publicImage(pid, "gallery", "-1")).rejects.toMatchObject({ status: 404 });
    await expect(f.service.publicImage(pid, "gallery", "99")).rejects.toMatchObject({ status: 404 });
  });
});

describe("공연별 본인 출연진 동의", () => {
  test("배역 배정만으로 이름·사진을 공개하지 않는다", async () => {
    const f = fixture(); await savedAndPublished(f);
    expect((await f.service.detailPublic(pid)).cast).toEqual([]);
    expect((await f.service.myCredits(actor)).items[0]).toMatchObject({ revision: 0, showName: false, showPhoto: false, eligible: true });
  });
  test("이름만 동의하면 공개 이름과 배역만 보이며 연락처·내부 식별자는 숨긴다", async () => {
    const f = fixture(); await savedAndPublished(f); await f.service.saveCredit(pid, credit(), actor);
    expect((await f.service.detailPublic(pid)).cast).toEqual([{ displayName: "공개 이름", roles: ["주인공"], photoUrl: null }]);
    const json = JSON.stringify(await f.service.detailPublic(pid));
    for (const privateValue of [actor.email, "membership", "내부 이름", "photoAssetId", "profileDetails", '"userId"']) expect(json).not.toContain(privateValue);
  });
  test("이름 없는 사진 동의, 옛 안내 버전, 타인 동의를 거절한다", async () => {
    const f = fixture();
    await expect(f.service.saveCredit(pid, credit({ showName: false, showPhoto: true }), actor)).rejects.toMatchObject({ status: 400 });
    await expect(f.service.saveCredit(pid, credit({ noticeVersion: "old" }), actor)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.saveCredit(pid, credit(), admin)).rejects.toMatchObject({ status: 404 });
  });
  test.each(["role", "cast", "status", "archived"])("%s 조건을 잃으면 출연진에서 즉시 빠지며 동의는 철회할 수 있다", async (state) => {
    const f = fixture(); await savedAndPublished(f); await f.service.saveCredit(pid, credit(), actor);
    if (state === "role") f.membership.roles = [];
    if (state === "cast") f.membership.castAssignments = [];
    if (state === "status") f.membership.user.status = "BLOCKED";
    if (state === "archived") f.membership.production.archived = true;
    expect((await f.service.detailPublic(pid)).cast).toEqual([]);
    await expect(f.service.saveCredit(pid, credit({ expectedRevision: 1, showName: false }), actor)).resolves.toMatchObject({ showName: false });
    await expect(f.service.saveCredit(pid, credit({ expectedRevision: 2 }), actor)).rejects.toMatchObject({ status: 403 });
  });
  test("현재 본인 프로필 사진에 동의하고 사진만 철회하면 이름은 남는다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = null; f.assetsById[imageId].ownerId = actor.id;
    await savedAndPublished(f); await f.service.saveCredit(pid, await photoCredit(f), actor);
    const detail = await f.service.detailPublic(pid);
    expect(detail.cast[0].photoUrl).toContain("/credits/credit-id/photo");
    await expect(f.service.publicImage(pid, "credit", "credit-id")).resolves.toEqual({ body: png, mime: "image/png" });
    await f.service.saveCredit(pid, credit({ expectedRevision: 1, showPhoto: false }), actor);
    expect((await f.service.detailPublic(pid)).cast).toEqual([{ displayName: "공개 이름", roles: ["주인공"], photoUrl: null }]);
    await expect(f.service.publicImage(pid, "credit", "credit-id")).rejects.toMatchObject({ status: 404 });
  });
  test("프로필 사진 변경 시 새 사진을 자동 공개하지 않고 재확인을 요구한다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = null; f.assetsById[imageId].ownerId = actor.id;
    await savedAndPublished(f); await f.service.saveCredit(pid, await photoCredit(f), actor);
    f.assetsById[otherImageId] = { ...f.assetsById[imageId], id: otherImageId }; f.membership.user.photoAssetId = otherImageId;
    expect((await f.service.detailPublic(pid)).cast).toEqual([{ displayName: "공개 이름", roles: ["주인공"], photoUrl: null }]);
    expect((await f.service.myCredits(actor)).items[0]).toMatchObject({ showName: true, showPhoto: false, hasProfilePhoto: true, photoNeedsConfirmation: true });
    await expect(f.service.publicImage(pid, "credit", "credit-id")).rejects.toMatchObject({ status: 404 });
    await f.service.saveCredit(pid, await photoCredit(f, { expectedRevision: 1 }), actor);
    expect((await f.service.myCredits(actor)).items[0]).toMatchObject({ showPhoto: true, photoNeedsConfirmation: false });
  });
  test("같은 assetID의 본문을 바꿔도 동의 당시 사진 지문과 다르면 공개하지 않는다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = null; f.assetsById[imageId].ownerId = actor.id; f.assetsById[imageId].checksum = null;
    await savedAndPublished(f); await f.service.saveCredit(pid, await photoCredit(f), actor);
    f.assets.readMockObject.mockResolvedValue({ body: Buffer.from([...png.subarray(0, 8), 90, 91, 92]) });
    await expect(f.service.publicImage(pid, "credit", "credit-id")).rejects.toMatchObject({ status: 404 });
  });
  test("사진을 읽는 사이 동의가 철회되면 읽은 본문도 내보내지 않는다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = null; f.assetsById[imageId].ownerId = actor.id;
    await savedAndPublished(f); await f.service.saveCredit(pid, await photoCredit(f), actor);
    f.assets.readMockObject.mockImplementation(async () => { f.membership.creditConsent = { ...f.membership.creditConsent, showPhoto: false, revision: 2 }; return { body: png }; });
    await expect(f.service.publicImage(pid, "credit", "credit-id")).rejects.toMatchObject({ status: 404 });
  });
  test("멤버십이 제거되거나 오래된 동의 버전이면 공개하지 않는다", async () => {
    const f = fixture(); await savedAndPublished(f); await f.service.saveCredit(pid, credit(), actor);
    f.membership.creditConsent.noticeVersion = "old";
    expect((await f.service.detailPublic(pid)).cast).toEqual([]);
    f.membership = null;
    expect((await f.service.detailPublic(pid)).cast).toEqual([]);
    await expect(f.service.saveCredit(pid, credit({ expectedRevision: 1, showName: false }), actor)).rejects.toMatchObject({ status: 404 });
  });
  test("다른 사용자가 올린 사진과 공연 자료를 프로필 사진으로 공개하지 못한다", async () => {
    const f = fixture(); await savedAndPublished(f);
    await expect(f.service.saveCredit(pid, await photoCredit(f), actor)).rejects.toMatchObject({ status: 400 });
    f.assetsById[imageId].productionId = null;
    await expect(f.service.saveCredit(pid, await photoCredit(f), actor)).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.performanceCreditConsent.create).not.toHaveBeenCalled();
  });
  test("동의의 stale revision 저장은 철회 상태를 덮어쓰지 못한다", async () => {
    const f = fixture(); await f.service.saveCredit(pid, credit(), actor);
    await f.service.saveCredit(pid, credit({ expectedRevision: 1, showName: false }), actor);
    await expect(f.service.saveCredit(pid, credit({ expectedRevision: 1 }), actor)).rejects.toMatchObject({ status: 409 });
    expect(f.membership.creditConsent.showName).toBe(false);
  });
});

describe("공개 정보 동시 수정 회귀", () => {
  test("사진을 미리 본 뒤 다른 탭에서 프로필 사진이 바뀌면 기존 token으로 동의하지 못한다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = null; f.assetsById[imageId].ownerId = actor.id;
    const previewed = await photoCredit(f);
    f.assetsById[otherImageId] = { ...f.assetsById[imageId], id: otherImageId }; f.membership.user.photoAssetId = otherImageId;
    await expect(f.service.saveCredit(pid, previewed, actor)).rejects.toMatchObject({ status: 409 });
    expect(f.prisma.performanceCreditConsent.create).not.toHaveBeenCalled();
    await expect(f.service.saveCredit(pid, await photoCredit(f), actor)).resolves.toMatchObject({ showPhoto: true });
  });
  test("미리 본 뒤 같은 assetID의 본문이 바뀌어도 기존 token은 거절한다", async () => {
    const f = fixture(); f.assetsById[imageId].productionId = null; f.assetsById[imageId].ownerId = actor.id; f.assetsById[imageId].checksum = null;
    const previewed = await photoCredit(f);
    f.assets.readMockObject.mockResolvedValue({ body: Buffer.from([...png.subarray(0, 8), 90, 91, 92]) });
    await expect(f.service.saveCredit(pid, previewed, actor)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.saveCredit(pid, credit({ showPhoto: true }), actor)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.saveCredit(pid, credit({ showName: false }), actor)).resolves.toMatchObject({ showName: false });
  });
  test("공연에서 배우로 배정된 스태프/기획자 겸업 회원도 출연진을 공개할 수 있다", async () => {
    const f = fixture(); f.membership.user.profileType = "PLANNER";
    await savedAndPublished(f); await f.service.saveCredit(pid, credit(), actor);
    expect((await f.service.detailPublic(pid)).cast).toEqual([{ displayName: "공개 이름", roles: ["주인공"], photoUrl: null }]);
    expect((await f.service.myCredits(actor)).items[0].eligible).toBe(true);
  });
  test("공개 사진을 읽는 동안 초안만 저장해도 공개 사진 응답은 유지한다", async () => {
    const f = fixture(); await savedAndPublished(f, document({ posterAssetId: imageId }));
    f.assets.readMockObject.mockImplementation(async () => {
      f.row = { ...f.row, revision: f.row.revision + 1, draft: document({ title: "수정 중", posterAssetId: null }) };
      return { body: png };
    });
    await expect(f.service.publicImage(pid, "poster")).resolves.toEqual({ body: png, mime: "image/png" });
  });
  test("페이지 크기/offset을 DB에 적용하고 KST 관객용 날짜 정렬과 전체 수를 반환한다", async () => {
    const f = fixture(); await savedAndPublished(f); f.prisma.productionShowcase.count.mockResolvedValue(200);
    const result = await f.service.listPublic(30, 60);
    expect(result).toMatchObject({ total: 200, hasMore: true, offset: 60 });
    const call = f.prisma.$queryRaw.mock.calls.find((entry: any[]) => entry[0][0].includes("SELECT s.production_id"));
    expect(call[0].join("?")).toContain("ORDER BY CASE");
    expect(call[0].join("?")).toContain("s.published->>'endDate'");
    expect(call[0].join("?")).not.toContain("current_phase");
    expect(call.slice(-2)).toEqual([30, 60]);
    expect(call[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
