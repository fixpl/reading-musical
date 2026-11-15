import { AssetsService } from "./assets.service";

const productionId = "11111111-1111-4111-8111-111111111111";
const admin = { id: "admin", platformRole: "SUPER_ADMIN", email: "a@b.c" } as never;

function fixture(extra: Record<string, string> = {}) {
  const env: Record<string, string> = { ASSET_STORAGE: "r2", R2_ACCOUNT_ID: "acc123", R2_ACCESS_KEY_ID: "AKIAFAKE", R2_SECRET_ACCESS_KEY: "secretfake", R2_BUCKET: "common", R2_KEY_PREFIX: "attachment", R2_PROJECT_NAME: "reading-musical", ...extra };
  const rows: Array<Record<string, unknown>> = [];
  const prisma = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: productionId }) },
    asset: {
      create: jest.fn().mockImplementation(async ({ data }) => { const row = { id: `asset-${rows.length}`, createdAt: new Date(), ...data }; rows.push(row); return row; }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => rows.find((row) => row.id === where.id) ?? null)
    }
  };
  const config = { get: (key: string) => env[key] };
  return { service: new AssetsService(prisma as never, config as never), prisma, rows };
}

describe("assets on R2", () => {
  test("a new asset gets an R2 key {prefix}/{project}/{folder}/{year}/{uuid-name} and a direct upload URL", async () => {
    const { service } = fixture();
    const created = await service.createAsset({ purpose: "CUE_MEDIA", productionId, fileName: "차 안.mp4", mimeType: "video/mp4", size: 5000 } as never, admin);
    expect(created.asset.storageKey).toMatch(new RegExp(`^attachment/reading-musical/cue-media/${new Date().getUTCFullYear()}/[0-9a-f-]{36}-mp4$|^attachment/reading-musical/cue-media/\\d{4}/[0-9a-f-]{36}-.*mp4$`));
    const upload = new URL(created.upload.url);
    expect(upload.host).toBe("acc123.r2.cloudflarestorage.com");
    expect(upload.pathname).toBe(`/common/${created.asset.storageKey}`);
    expect(created.upload.method).toBe("PUT");
    expect(upload.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(upload.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  });

  test("the signed download link carries inline and attachment variants with the stored mime type", async () => {
    const { service } = fixture();
    const created = await service.createAsset({ purpose: "CUE_MEDIA", productionId, fileName: "a.mp4", mimeType: "video/mp4", size: 5000 } as never, admin);
    const signed = await service.getSignedUrl(created.asset.id, admin) as { url: string; downloadUrl?: string };
    expect(new URL(signed.url).searchParams.get("response-content-disposition")).toMatch(/^inline;/);
    expect(new URL(signed.downloadUrl!).searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
    expect(new URL(signed.url).searchParams.get("response-content-type")).toBe("video/mp4");
  });

  test("files left over on local disk keep using the local signed route", async () => {
    const { service, prisma, rows } = fixture();
    rows.push({ id: "old", productionId, kind: "VIDEO", mime: "video/mp4", sizeBytes: 10, fileName: "old.mp4", storageKey: `cue-media/${productionId}/uuid-old.mp4`, ownerId: "admin" });
    const signed = await service.getSignedUrl("old", admin) as { url: string; downloadUrl?: string };
    expect(signed.url).toContain("/assets/old/mock-object?action=download");
    expect(signed.downloadUrl).toBeUndefined();
    expect(prisma.asset.findUnique).toHaveBeenCalled();
  });

  test("project renaming keeps legacy asset downloads on R2 while new registrations use art-bridge", async () => {
    const { service, rows } = fixture({ R2_PROJECT_NAME: "art-bridge", R2_LEGACY_PROJECT_NAMES: "reading-musical" });
    const oldKey = "attachment/reading-musical/cue-media/2026/uuid-old.mp4";
    rows.push({ id: "old-r2", productionId, kind: "VIDEO", mime: "video/mp4", sizeBytes: 10, fileName: "old.mp4", storageKey: oldKey, ownerId: "admin" });
    const signed = await service.getSignedUrl("old-r2", admin) as { url: string; downloadUrl?: string };
    expect(new URL(signed.url).pathname).toBe(`/common/${oldKey}`);
    expect(new URL(signed.downloadUrl!).pathname).toBe(`/common/${oldKey}`);
    expect(service.isShowcaseImageStorageKey("attachment/reading-musical/showcase/2026/old.png")).toBe(true);
    expect(service.isShowcaseImageStorageKey(oldKey)).toBe(false);
    expect(service.isShowcaseImageStorageKey("attachment/other/showcase/2026/old.png")).toBe(false);
    await expect(service.assertMockObjectAccess("old-r2", "download", {})).rejects.toMatchObject({ status: 404 });
    const created = await service.createAsset({ purpose: "CUE_MEDIA", productionId, fileName: "new.mp4", mimeType: "video/mp4", size: 5000 } as never, admin);
    expect(created.asset.storageKey).toMatch(/^attachment\/art-bridge\/cue-media\//);
  });

  test("the local mock-object route refuses R2 files", async () => {
    const { service } = fixture();
    const created = await service.createAsset({ purpose: "CUE_MEDIA", productionId, fileName: "a.mp4", mimeType: "video/mp4", size: 5000 } as never, admin);
    await expect(service.assertMockObjectAccess(created.asset.id, "download", {})).rejects.toMatchObject({ status: 404 });
  });

  test("attaching checks the object really arrived with the declared size", async () => {
    const { service } = fixture();
    const stat = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ sizeBytes: 99 }).mockResolvedValueOnce({ sizeBytes: 5000 });
    (service as unknown as { r2: { stat: typeof stat; owns: () => boolean } }).r2 = { stat, owns: () => true } as never;
    const asset = { id: "a", sizeBytes: 5000, storageKey: "attachment/reading-musical/cue-media/2026/x.mp4" };
    await expect(service.assertStoredObject(asset)).rejects.toMatchObject({ status: 400 });
    await expect(service.assertStoredObject(asset)).rejects.toMatchObject({ status: 400 });
    await expect(service.assertStoredObject(asset)).resolves.toBeUndefined();
  });

  test("server-generated files are written straight to R2", async () => {
    const { service } = fixture();
    const created = await service.createAsset({ purpose: "CUE_MEDIA", productionId, fileName: "a.mp4", mimeType: "video/mp4", size: 3 } as never, admin);
    const put = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { r2: { put: typeof put; owns: () => boolean } }).r2 = { put, owns: () => true } as never;
    await expect(service.storeMockObject(created.asset.id, Buffer.from("abc"))).resolves.toMatchObject({ stored: true, sizeBytes: 3 });
    expect(put).toHaveBeenCalledWith(created.asset.storageKey, Buffer.from("abc"), "video/mp4");
  });
});
