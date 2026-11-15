import { AssetPurpose } from "../assets/dto";
import { AssetsService } from "../assets/assets.service";

const pid = "11111111-1111-4111-8111-111111111111";
const admin = { id: "admin", platformRole: "SUPER_ADMIN" } as never;
function fixture() {
  const prisma = { production: { findFirst: jest.fn().mockResolvedValue({ id: pid }) }, asset: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: "asset", ...data })) } };
  const config = { get: () => undefined };
  return { service: new AssetsService(prisma as never, config as never), prisma };
}
describe("홍보 사진 업로드 목적", () => {
  const input = { purpose: AssetPurpose.SHOWCASE_IMAGE, productionId: pid, fileName: "포스터.png", mimeType: "image/png", size: 10 };
  test("홍보 사진은 sha256 확인값이 없으면 업로드 주소를 발급하지 않는다", async () => {
    const f = fixture(); await expect(f.service.createAsset(input, admin)).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.asset.create).not.toHaveBeenCalled();
  });
  test("홍보 사진은 공연별 저장 경로/IMAGE 타입과 고정 checksum을 사용한다", async () => {
    const f = fixture(); const checksum = `sha256:${"a".repeat(64)}`;
    const output = await f.service.createAsset({ ...input, checksum }, admin);
    expect(output.asset).toMatchObject({ productionId: pid, kind: "IMAGE", checksum });
    expect(output.asset.storageKey).toContain(`showcase/${pid}/`);
  });
  test("홍보 사진의 공연 누락·SVG·10MB 초과를 거절한다", async () => {
    const f = fixture(); const checksum = `sha256:${"a".repeat(64)}`;
    await expect(f.service.createAsset({ ...input, checksum, productionId: undefined }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(f.service.createAsset({ ...input, checksum, fileName: "a.svg", mimeType: "image/svg+xml" }, admin)).rejects.toMatchObject({ status: 415 });
    await expect(f.service.createAsset({ ...input, checksum, size: 10 * 1024 * 1024 + 1 }, admin)).rejects.toMatchObject({ status: 413 });
  });
  test("프로필 사진 등 기존 업로드의 선택 checksum 계약은 유지한다", async () => {
    const f = fixture(); await expect(f.service.createAsset({ ...input, purpose: AssetPurpose.PROFILE_PHOTO, productionId: undefined }, admin)).resolves.toHaveProperty("upload.url");
  });
});
