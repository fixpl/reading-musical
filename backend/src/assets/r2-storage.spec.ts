import { R2Storage, readR2Settings, resolveStorageDriver } from "./r2-storage";

const settings = { accountId: "acc123", accessKeyId: "AKIAFAKE", secretAccessKey: "secretfake", bucket: "common", projectName: "reading-musical", keyPrefix: "attachment" };

describe("R2 storage", () => {
  const storage = new R2Storage(settings);

  test("keys follow {prefix}/{project}/{folder}/{year}/{file} and only R2 keys are owned", () => {
    const key = storage.buildKey("cue-media", "uuid-영상.mp4", new Date("2026-10-08T00:00:00Z"));
    expect(key).toBe("attachment/reading-musical/cue-media/2026/uuid-영상.mp4");
    expect(storage.owns(key)).toBe(true);
    expect(storage.owns("cue-media/prod/uuid-a.mp4")).toBe(false);
    expect(new R2Storage({ ...settings, keyPrefix: "" }).buildKey("background", "x.mp4", new Date("2027-01-01T00:00:00Z"))).toBe("reading-musical/background/2027/x.mp4");
  });

  test("new keys use the current project while only explicitly listed legacy projects remain readable", async () => {
    const migrated = new R2Storage({ ...settings, projectName: "art-bridge", legacyProjectNames: ["reading-musical"] });
    const oldKey = "attachment/reading-musical/cue-media/2026/old.mp4";
    expect(migrated.buildKey("cue-media", "new.mp4", new Date("2026-10-24T00:00:00Z"))).toBe("attachment/art-bridge/cue-media/2026/new.mp4");
    expect(migrated.owns(oldKey)).toBe(true);
    const url = new URL(await migrated.presignDownload(oldKey, { mime: "video/mp4", fileName: "old.mp4", attachment: false }, 600));
    expect(url.pathname).toBe(`/common/${oldKey}`);
    for (const key of ["attachment/other/cue-media/2026/x.mp4", "attachment/reading-musical-extra/cue-media/2026/x.mp4", "different/reading-musical/cue-media/2026/x.mp4", "reading-musical/cue-media/2026/x.mp4", "cue-media/production/x.mp4"]) {
      expect(migrated.owns(key)).toBe(false);
    }
    expect(new R2Storage({ ...settings, projectName: "art-bridge" }).owns(oldKey)).toBe(false);
  });

  test("legacy purpose folders keep their exact boundary even when the fixed prefix repeats a purpose", () => {
    const migrated = new R2Storage({ ...settings, keyPrefix: "showcase", projectName: "art-bridge", legacyProjectNames: ["reading-musical"] });
    expect(migrated.isInFolder("showcase/reading-musical/showcase/2026/old.png", "showcase")).toBe(true);
    expect(migrated.isInFolder("showcase/reading-musical/cue-media/2026/old.png", "showcase")).toBe(false);
    expect(migrated.isInFolder("showcase/reading-musical/showcase-extra/2026/old.png", "showcase")).toBe(false);
    expect(migrated.isInFolder("showcase/other/showcase/2026/old.png", "showcase")).toBe(false);
  });

  test("an upload URL points at the R2 endpoint, expires, and signs the declared size", async () => {
    const url = new URL(await storage.presignUpload("attachment/reading-musical/cue-media/2026/a.mp4", 1234, 600));
    expect(url.host).toBe("acc123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/common/attachment/reading-musical/cue-media/2026/a.mp4");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  });

  test("a showcase word in the fixed prefix cannot make rehearsal media a showcase image", () => {
    const scoped = new R2Storage({ ...settings, keyPrefix: "showcase" });
    expect(scoped.isInFolder(scoped.buildKey("cue-media", "image.png"), "showcase")).toBe(false);
    expect(scoped.isInFolder(scoped.buildKey("showcase", "image.png"), "showcase")).toBe(true);
  });

  test("a download URL forces the stored mime type and disposition, with a UTF-8 file name", async () => {
    const url = new URL(await storage.presignDownload("attachment/reading-musical/cue-media/2026/a.pdf", { mime: "application/pdf", fileName: "악보 1.pdf", attachment: true }, 600));
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''%EC%95%85%EB%B3%B4%201.pdf");
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
  });

  test("stat and read treat a missing object as null and surface other errors", async () => {
    const send = jest.fn()
      .mockRejectedValueOnce({ name: "NotFound", $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ ContentLength: 42 })
      .mockRejectedValueOnce({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const fake = new R2Storage(settings, { send } as never);
    await expect(fake.stat("k")).resolves.toBeNull();
    await expect(fake.stat("k")).resolves.toEqual({ sizeBytes: 42 });
    await expect(fake.read("k")).resolves.toBeNull();
    await expect(fake.read("k")).rejects.toMatchObject({ name: "AccessDenied" });
  });

  test("settings are read only when ASSET_STORAGE=r2 and must be complete", () => {
    expect(readR2Settings({})).toBeNull();
    expect(readR2Settings({ ASSET_STORAGE: "local" })).toBeNull();
    expect(() => readR2Settings({ ASSET_STORAGE: "r2", R2_ACCOUNT_ID: "a" })).toThrow("R2_ACCESS_KEY_ID");
    expect(readR2Settings({ ASSET_STORAGE: "R2", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_KEY_PREFIX: "/attachment/" })).toMatchObject({ bucket: "d", keyPrefix: "attachment", projectName: "reading-musical" });
  });

  test("accepts the *_NAME / *_URL variable names and turns R2 on by itself when the credentials are complete", () => {
    const env = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET_NAME: "attachment", R2_ENDPOINT_URL: "https://a.r2.cloudflarestorage.com", R2_REGION: "auto" };
    expect(resolveStorageDriver(env)).toBe("r2");
    expect(resolveStorageDriver({ ...env, ASSET_STORAGE: "local" })).toBe("local");
    expect(resolveStorageDriver({ ...env, R2_SECRET_ACCESS_KEY: "" })).toBe("local");
    expect(readR2Settings(env)).toMatchObject({ bucket: "attachment", endpoint: "https://a.r2.cloudflarestorage.com", region: "auto", keyPrefix: "", projectName: "reading-musical" });
    expect(new R2Storage(readR2Settings(env)!).buildKey("cue-media", "x.mp4", new Date("2026-01-01T00:00:00Z"))).toBe("reading-musical/cue-media/2026/x.mp4");
  });

  test("normalizes explicit legacy names and removes duplicates and the current project", () => {
    const env = { ASSET_STORAGE: "r2", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_PROJECT_NAME: "art-bridge" };
    expect(readR2Settings({ ...env, R2_LEGACY_PROJECT_NAMES: " reading-musical,reading-musical, art-bridge,archive " })?.legacyProjectNames).toEqual(["reading-musical", "archive"]);
    expect(readR2Settings({ ...env, R2_LEGACY_PROJECT_NAMES: " " })?.legacyProjectNames).toEqual([]);
    expect(readR2Settings(env)?.legacyProjectNames).toEqual([]);
  });

  test.each(["*", "reading-*", "?", ".", "..", "../reading-musical", "reading-musical/other", "/reading-musical/", "reading-musical\\other", "reading-musical,,archive", ",reading-musical", "reading-musical, ", "reading musical", "%2e%2e", "reading-musical\narchive"])("rejects unsafe legacy project configuration %j", (legacy) => {
    expect(() => readR2Settings({ ASSET_STORAGE: "r2", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_LEGACY_PROJECT_NAMES: legacy })).toThrow("R2_LEGACY_PROJECT_NAMES");
  });

  test.each(["/", "*", "..", "another/project", "../project"])("rejects an unsafe current project %j", (current) => {
    expect(() => readR2Settings({ ASSET_STORAGE: "r2", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_PROJECT_NAME: current })).toThrow("R2_PROJECT_NAME");
  });
});
