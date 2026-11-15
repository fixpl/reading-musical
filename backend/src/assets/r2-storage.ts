import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2(S3 호환) 저장소. 브라우저가 서명된 주소로 R2에 직접 올리고 받으므로 API 서버는 파일 본문을 거치지 않는다.
export type R2Settings = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** 같은 버킷을 여러 프로젝트가 쓰므로 키의 첫 구간이 프로젝트 이름이다. */
  projectName: string;
  /** 같은 버킷·고정 경로에서 계속 읽을 이전 프로젝트. 신규 파일은 projectName에만 저장한다. */
  legacyProjectNames?: string[];
  /** 키 맨 앞에 붙는 고정 경로(예: "attachment"). 비우면 붙지 않는다. */
  keyPrefix: string;
  endpoint?: string;
  region?: string;
};

export type ObjectStat = { sizeBytes: number };

const clean = (value: string) => value.replace(/^\/+|\/+$/g, "");

function validateProjectName(value: string, key: string): string {
  if (!value || value === "." || value === ".." || /[\\/\s*?%\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${key} must contain literal project names without paths or wildcards.`);
  }
  return value;
}

function normalizeLegacyProjectNames(names: string[], current: string): string[] {
  return [...new Set(names.map((name) => validateProjectName(name.trim(), "R2_LEGACY_PROJECT_NAMES")))].filter((name) => name !== current);
}

/** 변수 이름은 R2_BUCKET / R2_BUCKET_NAME, R2_ENDPOINT / R2_ENDPOINT_URL 둘 다 받는다. */
const pick = (env: Record<string, string | undefined>, ...keys: string[]) => keys.map((key) => env[key]?.trim()).find(Boolean);

/** 저장소 종류: ASSET_STORAGE를 직접 정하지 않았으면 R2 정보가 모두 있을 때 R2, 아니면 서버 디스크. */
export function resolveStorageDriver(env: Record<string, string | undefined>): "local" | "r2" {
  const explicit = env.ASSET_STORAGE?.trim().toLowerCase();
  if (explicit) return explicit === "r2" ? "r2" : "local";
  return pick(env, "R2_ACCOUNT_ID") && pick(env, "R2_ACCESS_KEY_ID") && pick(env, "R2_SECRET_ACCESS_KEY") && pick(env, "R2_BUCKET", "R2_BUCKET_NAME") ? "r2" : "local";
}

export function readR2Settings(env: Record<string, string | undefined>): R2Settings | null {
  if (resolveStorageDriver(env) !== "r2") return null;
  const values = {
    R2_ACCOUNT_ID: pick(env, "R2_ACCOUNT_ID"), R2_ACCESS_KEY_ID: pick(env, "R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: pick(env, "R2_SECRET_ACCESS_KEY"), R2_BUCKET: pick(env, "R2_BUCKET", "R2_BUCKET_NAME")
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`ASSET_STORAGE=r2 에는 ${missing.join(", ")} 설정이 필요합니다.`);
  const currentProject = validateProjectName(clean(env.R2_PROJECT_NAME?.trim() || "reading-musical"), "R2_PROJECT_NAME");
  const legacyProjects = env.R2_LEGACY_PROJECT_NAMES?.trim();
  return {
    accountId: values.R2_ACCOUNT_ID!, accessKeyId: values.R2_ACCESS_KEY_ID!, secretAccessKey: values.R2_SECRET_ACCESS_KEY!, bucket: values.R2_BUCKET!,
    projectName: currentProject,
    legacyProjectNames: normalizeLegacyProjectNames(legacyProjects ? legacyProjects.split(",") : [], currentProject),
    keyPrefix: clean(env.R2_KEY_PREFIX?.trim() || ""),
    endpoint: pick(env, "R2_ENDPOINT", "R2_ENDPOINT_URL"),
    region: env.R2_REGION?.trim() || "auto"
  };
}

export class R2Storage {
  private readonly client: S3Client;
  private readonly readableRoots: string[];

  constructor(private readonly settings: R2Settings, client?: S3Client) {
    const currentProject = validateProjectName(settings.projectName, "R2_PROJECT_NAME");
    this.readableRoots = [currentProject, ...normalizeLegacyProjectNames(settings.legacyProjectNames ?? [], currentProject)].map((name) => this.root(name));
    this.client = client ?? new S3Client({
      region: settings.region || "auto",
      endpoint: settings.endpoint || `https://${settings.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // R2는 가상 호스트 방식도 되지만 버킷 이름이 도메인에 들어가지 않는 경로 방식이 설정이 단순하다.
      forcePathStyle: true
    });
  }

  /** 이 저장소에 있는 키인지 — 예전 로컬 파일 키(cue-media/…)와 구분한다. */
  owns(storageKey: string): boolean {
    return this.readableRoots.some((root) => storageKey.startsWith(root));
  }

  /** 고정 prefix에 같은 단어가 있어도 실제 파일 목적 폴더와 혼동하지 않는다. */
  isInFolder(storageKey: string, folder: string): boolean {
    return this.readableRoots.some((root) => storageKey.startsWith(`${root}${clean(folder)}/`));
  }

  /** {고정경로}/{프로젝트}/{폴더}/{연도}/{고유값-파일명} */
  buildKey(folder: string, uniqueFileName: string, now = new Date()): string {
    return `${this.root()}${clean(folder)}/${now.getUTCFullYear()}/${uniqueFileName}`;
  }

  private root(project = this.settings.projectName): string {
    return `${this.settings.keyPrefix ? `${this.settings.keyPrefix}/` : ""}${project}/`;
  }

  /** 올리기용 서명 주소. 크기를 서명에 넣어 신고한 크기와 다른 본문은 R2가 거부한다. */
  async presignUpload(key: string, sizeBytes: number, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, ContentLength: sizeBytes }), {
      expiresIn: ttlSeconds,
      signableHeaders: new Set(["content-length"])
    });
  }

  /** 받기·재생용 서명 주소. 파일 형식과 열기/내려받기 방식은 DB 값으로 덮어써 올린 사람이 정한 값을 믿지 않는다. */
  async presignDownload(key: string, options: { mime: string; fileName: string; attachment: boolean }, ttlSeconds: number): Promise<string> {
    const encoded = encodeURIComponent(options.fileName).replace(/['()]/g, escape).replace(/\*/g, "%2A");
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.settings.bucket,
      Key: key,
      ResponseContentType: options.mime,
      ResponseContentDisposition: `${options.attachment ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
      ResponseCacheControl: "private, no-store"
    }), { expiresIn: ttlSeconds });
  }

  /** 서버가 만든 파일(진행표·무대 내보내기 PDF 등)을 직접 올린다. */
  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentType: mime, ContentLength: body.length }));
  }

  /** 올라와 있으면 크기를, 없으면 null. */
  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return { sizeBytes: Number(head.ContentLength ?? 0) };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
      throw error;
    }
  }

  /** 문서 가져오기처럼 서버가 본문을 읽어야 할 때만 쓴다(50MB 이하 문서). */
  async read(key: string): Promise<Buffer | null> {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      const bytes = await object.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }
}
