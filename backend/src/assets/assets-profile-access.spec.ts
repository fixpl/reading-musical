import { AssetsService } from "./assets.service";
import type { RequestUser } from "../common/types/request-user";

const asset = { id: "photo", ownerId: "owner", productionId: null, kind: "IMAGE", mime: "image/png", sizeBytes: 1, storageKey: "profile/photo.png" };
const viewer: RequestUser = { id: "viewer", email: "viewer@example.test", name: "참여자", platformRole: "MEMBER" };

function fixture(options: { currentPhoto?: string | null; deleted?: boolean; archived?: boolean; sharesProduction?: boolean } = {}) {
  const currentPhoto = options.currentPhoto === undefined ? asset.id : options.currentPhoto;
  const deletedAt = options.deleted ? new Date(0) : null;
  const prisma = {
    asset: { findUnique: jest.fn().mockResolvedValue(asset) },
    membership: { findFirst: jest.fn().mockImplementation(async ({ where }) => {
      if (options.sharesProduction === false) return null;
      if (where.user?.photoAssetId !== undefined && where.user.photoAssetId !== currentPhoto) return null;
      if (where.production?.deletedAt === null && deletedAt !== null) return null;
      if (where.production?.archived === false && options.archived) return null;
      return { id: "shared-membership" };
    }) }
  };
  return { service: new AssetsService(prisma as never, { get: () => undefined } as never), prisma };
}

describe("공연팀 프로필 사진 접근", () => {
  it.each([{}, { archived: true }])("삭제되지 않은 공동 공연의 현재 사진은 공유한다: %p", async (options) => {
    const { service, prisma } = fixture(options);
    await expect(service.getSignedUrl(asset.id, viewer)).resolves.toMatchObject({ assetId: asset.id });
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: asset.ownerId, user: { photoAssetId: asset.id },
      production: { deletedAt: null, memberships: { some: { userId: viewer.id } } }
    }) }));
  });

  it.each([{ currentPhoto: null }, { currentPhoto: "new-photo" }, { deleted: true }, { sharesProduction: false }])("해제·교체·공연 삭제·미참여 사진은 새 URL을 발급하지 않는다: %p", async (options) => {
    const { service } = fixture(options);
    await expect(service.getSignedUrl(asset.id, viewer)).rejects.toMatchObject({ status: 403 });
  });

  it.each([{ ...viewer, id: asset.ownerId }, { ...viewer, platformRole: "SUPER_ADMIN" as const }])("소유자와 플랫폼 관리자의 접근은 유지한다", async (user) => {
    const { service, prisma } = fixture({ currentPhoto: null, deleted: true });
    await expect(service.getSignedUrl(asset.id, user)).resolves.toMatchObject({ assetId: asset.id });
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
  });
});
