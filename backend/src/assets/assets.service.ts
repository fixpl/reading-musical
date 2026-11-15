import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AssetKind, ProductionRole } from "@prisma/client";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { AssetPurpose, AssetPolicy, CreateAssetDto } from "./dto";
import { assertProductionMembership } from "../common/access/assert-production-membership";
import { R2Storage, readR2Settings } from "./r2-storage";

const MUSIC_EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.MUSIC_DIRECTOR];
const SCRIPT_EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR];
const STAGE_EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.STAGE_MANAGER];
const CHECKLIST_EVIDENCE_ROLES = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF
];
const VIEW_ROLES = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];

const ASSET_POLICIES: Record<AssetPurpose, AssetPolicy> = {
  [AssetPurpose.SHOWCASE_IMAGE]: {
    kind: AssetKind.IMAGE,
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    allowedExtensionsByMime: { "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"] },
    storagePrefix: "showcase"
  },
  [AssetPurpose.PERFORMANCE_MATERIAL]: {
    // 원본 악보는 추출/OCR 없이도 보관할 수 있다. 실행 가능한 SVG/HTML은 제외한다.
    kind: AssetKind.DOCUMENT,
    maxBytes: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    allowedExtensionsByMime: {
      "application/pdf": ["pdf"], "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"],
      "text/plain": ["txt"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"]
    },
    storagePrefix: "performance-materials"
  },
  [AssetPurpose.MUSIC_TRACK]: {
    kind: AssetKind.AUDIO,
    maxBytes: 200 * 1024 * 1024,
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/x-m4a"],
    allowedExtensionsByMime: {
      "audio/mpeg": ["mp3"],
      "audio/mp3": ["mp3"],
      "audio/wav": ["wav"],
      "audio/x-wav": ["wav"],
      "audio/mp4": ["m4a", "mp4"],
      "audio/aac": ["aac"],
      "audio/x-m4a": ["m4a"]
    },
    storagePrefix: "music"
  },
  [AssetPurpose.SCRIPT_IMPORT]: {
    kind: AssetKind.DOCUMENT,
    maxBytes: 50 * 1024 * 1024,
    allowedMimeTypes: [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ],
    allowedExtensionsByMime: {
      "text/plain": ["txt"],
      "application/pdf": ["pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"]
    },
    storagePrefix: "scripts"
  },
  [AssetPurpose.STAGE_EXPORT]: {
    kind: AssetKind.IMAGE,
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf"],
    allowedExtensionsByMime: {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "application/pdf": ["pdf"]
    },
    storagePrefix: "stage"
  },
  [AssetPurpose.RUN_SHEET_EXPORT]: {
    kind: AssetKind.DOCUMENT,
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["text/html", "application/pdf"],
    allowedExtensionsByMime: {
      "text/html": ["html"],
      "application/pdf": ["pdf"]
    },
    storagePrefix: "run-sheets"
  },
  [AssetPurpose.PROFILE_PHOTO]: {
    kind: AssetKind.IMAGE,
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    allowedExtensionsByMime: {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"]
    },
    storagePrefix: "profile"
  },
  [AssetPurpose.CHECKLIST_EVIDENCE]: {
    kind: AssetKind.DOCUMENT,
    maxBytes: 50 * 1024 * 1024,
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ],
    allowedExtensionsByMime: {
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"],
      "application/pdf": ["pdf"],
      "text/plain": ["txt"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"]
    },
    storagePrefix: "checklist"
  },
  [AssetPurpose.BACKGROUND_VIDEO]: {
    kind: AssetKind.VIDEO,
    maxBytes: 500 * 1024 * 1024,
    // 새로 올리는 영상은 MP4(H.264)만 받는다. 이미 올라온 webm·mov는 그대로 재생된다.
    allowedMimeTypes: ["video/mp4"],
    allowedExtensionsByMime: {
      "video/mp4": ["mp4", "m4v"]
    },
    storagePrefix: "background"
  },
  [AssetPurpose.CUE_MEDIA]: {
    // 타임라인의 배경 이미지·영상·음원. SVG/HTML은 실행 가능한 형식이므로 허용하지 않는다.
    kind: AssetKind.VIDEO,
    maxBytes: 500 * 1024 * 1024,
    allowedMimeTypes: [
      "video/mp4",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/aac",
      "audio/x-m4a",
      "image/png",
      "image/jpeg",
      "image/webp"
    ],
    allowedExtensionsByMime: {
      "video/mp4": ["mp4", "m4v"],
      "audio/mpeg": ["mp3"],
      "audio/mp3": ["mp3"],
      "audio/wav": ["wav"],
      "audio/x-wav": ["wav"],
      "audio/mp4": ["m4a", "mp4"],
      "audio/aac": ["aac"],
      "audio/x-m4a": ["m4a"],
      "image/png": ["png"],
      "image/jpeg": ["jpg", "jpeg"],
      "image/webp": ["webp"]
    },
    storagePrefix: "cue-media"
  }
};

type MockObjectSignatureQuery = {
  action?: string;
  expires?: string;
  signature?: string;
};

@Injectable()
export class AssetsService {
  /** ASSET_STORAGE=r2 이면 Cloudflare R2, 아니면 null(서버 디스크 — 로컬 개발용). */
  private readonly r2: R2Storage | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    const keys = ["ASSET_STORAGE", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_BUCKET_NAME", "R2_PROJECT_NAME", "R2_LEGACY_PROJECT_NAMES", "R2_KEY_PREFIX", "R2_ENDPOINT", "R2_ENDPOINT_URL", "R2_REGION"];
    const settings = readR2Settings(Object.fromEntries(keys.map((key) => [key, this.config.get<string>(key)])));
    this.r2 = settings ? new R2Storage(settings) : null;
  }

  /** 이 파일 본문이 R2에 있는가(예전 로컬 키로 남은 파일은 계속 서버 디스크에서 읽는다). */
  private inR2(storageKey: string) {
    return Boolean(this.r2?.owns(storageKey));
  }

  /** 홍보에 직접 올린 이미지만 공개 대상으로 선택할 수 있다. */
  isShowcaseImageStorageKey(storageKey: string) {
    const folder = ASSET_POLICIES[AssetPurpose.SHOWCASE_IMAGE].storagePrefix;
    return this.r2 && this.inR2(storageKey) ? this.r2.isInFolder(storageKey, folder) : storageKey.startsWith(`${folder}/`);
  }

  async createAsset(dto: CreateAssetDto, user: RequestUser) {
    const policy = ASSET_POLICIES[dto.purpose];
    if (!policy) {
      throw new BadRequestException("지원하지 않는 업로드 목적이에요");
    }
    if (dto.size > policy.maxBytes) {
      throw this.fileTooLargeException(policy.maxBytes);
    }
    this.assertAllowedFileType(dto, policy);
    if (dto.purpose !== AssetPurpose.PROFILE_PHOTO && !dto.productionId) {
      throw new BadRequestException("공연 파일은 productionId가 필요해요");
    }

    if (dto.productionId) {
      await this.assertMembership(dto.productionId, user, this.rolesForPurpose(dto.purpose));
    }

    const kind = this.resolveAssetKind(dto.purpose, dto.mimeType, policy);
    const storageKey = this.r2
      ? this.r2.buildKey(policy.storagePrefix, `${randomUUID()}-${this.safeFileName(dto.fileName)}`)
      : this.buildStorageKey(policy.storagePrefix, dto.productionId ?? user.id, dto.fileName);
    const checksum = this.normalizeChecksum(dto.checksum);
    if (dto.purpose === AssetPurpose.SHOWCASE_IMAGE && !checksum) {
      throw new BadRequestException("공연 홍보 사진은 파일 확인값이 필요해요. 사진을 다시 선택해 주세요");
    }
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: user.id,
        productionId: dto.productionId ?? null,
        kind,
        storageKey,
        fileName: dto.fileName.split(/[\\/]/).pop()?.normalize("NFC").replace(/[\u0000-\u001f]/g, "").slice(0, 255) || "자료",
        mime: dto.mimeType,
        sizeBytes: dto.size,
        checksum
      }
    });

    return {
      asset,
      upload: await this.signedUrl("upload", asset),
      download: await this.signedUrl("download", asset),
      policy: {
        kind,
        maxBytes: policy.maxBytes,
        allowedMimeTypes: policy.allowedMimeTypes,
        allowedExtensions: this.formatAllowedExtensions(policy)
      }
    };
  }

  /** 공연의 미디어(영상·음원) 파일 목록 — 큐시트 미디어 라이브러리·큐 첨부 선택용. */
  async listProductionMedia(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.prisma.asset.findMany({
      where: { productionId, kind: { in: [AssetKind.AUDIO, AssetKind.VIDEO, AssetKind.IMAGE] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, mime: true, sizeBytes: true, storageKey: true, createdAt: true }
    });
  }

  async getSignedUrl(assetId: string, user: RequestUser) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("파일을 찾을 수 없어요");
    }
    if (asset.productionId) {
      await this.assertMembership(asset.productionId, user, VIEW_ROLES);
    } else if (asset.ownerId !== user.id && user.platformRole !== "SUPER_ADMIN") {
      const canViewSharedProfilePhoto =
        this.isPersonalProfileImageAsset(asset) && (await this.sharesCurrentProfilePhoto(asset.ownerId, user.id, asset.id));
      if (!canViewSharedProfilePhoto) {
        throw new ForbiddenException("이 파일을 볼 권한이 없어요");
      }
    }

    return {
      assetId: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      ...(await this.signedUrl("download", asset)),
      // R2는 주소에 열기/내려받기 방식이 서명에 들어가므로 내려받기용 주소를 따로 준다.
      ...(this.inR2(asset.storageKey) ? { downloadUrl: (await this.signedUrl("download", asset, true)).url } : {})
    };
  }

  async assertMockObjectAccess(assetId: string, action: "upload" | "download", query: MockObjectSignatureQuery) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("파일을 찾을 수 없어요");
    }
    // R2에 있는 파일은 이 서버를 거치지 않고 R2 서명 주소로만 받는다.
    if (this.inR2(asset.storageKey)) {
      throw new NotFoundException("이 파일은 저장소 주소로 받아야 해요");
    }
    if (query.action !== action || !query.expires || !query.signature) {
      throw new ForbiddenException("유효한 signed URL이 필요해요");
    }

    const expiresAt = new Date(query.expires);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException("signed URL이 만료되었어요");
    }

    const expectedSignature = this.signObjectAction(action, asset.id, asset.storageKey, query.expires);
    if (!this.matchesSignature(query.signature, expectedSignature)) {
      throw new ForbiddenException("signed URL 서명이 올바르지 않아요");
    }
  }

  async storeMockObject(assetId: string, body: Buffer) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("파일을 찾을 수 없어요");
    }
    if (body.length > asset.sizeBytes) {
      throw this.fileTooLargeException(asset.sizeBytes);
    }
    this.assertChecksumMatches(asset.checksum, body);

    if (this.r2 && this.inR2(asset.storageKey)) {
      await this.r2.put(asset.storageKey, body, asset.mime);
      return { assetId, stored: true, sizeBytes: body.length };
    }

    const filePath = this.objectPath(assetId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return {
      assetId,
      stored: true,
      sizeBytes: body.length
    };
  }

  /** 메타데이터만 만든 파일이나 중단된 업로드를 구간 첨부로 등록하지 않는다. */
  async assertStoredObject(asset: { id: string; sizeBytes: number; storageKey?: string }) {
    if (asset.storageKey && this.r2 && this.inR2(asset.storageKey)) {
      const found = await this.r2.stat(asset.storageKey);
      if (!found) throw new BadRequestException("파일 업로드가 완료되지 않았습니다. 파일을 다시 올린 뒤 첨부하세요.");
      if (asset.sizeBytes <= 0 || found.sizeBytes !== asset.sizeBytes) throw new BadRequestException("업로드된 파일 크기가 일치하지 않습니다. 파일을 다시 올려 주세요.");
      return;
    }
    let fileStat;
    try { fileStat = await stat(this.objectPath(asset.id)); }
    catch { throw new BadRequestException("파일 업로드가 완료되지 않았습니다. 파일을 다시 올린 뒤 첨부하세요."); }
    if (!fileStat.isFile() || asset.sizeBytes <= 0 || fileStat.size !== asset.sizeBytes) {
      throw new BadRequestException("업로드된 파일 크기가 일치하지 않습니다. 파일을 다시 올려 주세요.");
    }
  }

  async readMockObject(assetId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("파일을 찾을 수 없어요");
    }

    if (this.r2 && this.inR2(asset.storageKey)) {
      const body = await this.r2.read(asset.storageKey);
      if (!body) throw new NotFoundException("업로드된 파일 본문을 찾을 수 없어요");
      return { asset, body, sizeBytes: body.length };
    }

    const filePath = this.objectPath(assetId);
    try {
      const [body, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
      return { asset, body, sizeBytes: fileStat.size };
    } catch {
      throw new NotFoundException("업로드된 파일 본문을 찾을 수 없어요");
    }
  }

  // 재생 요청은 전체 파일을 메모리에 올리지 않고 필요한 byte 구간만 스트리밍한다.
  async getMockObjectInfo(assetId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException("파일을 찾을 수 없어요");
    const filePath = this.objectPath(assetId);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");
      return { asset, filePath, sizeBytes: fileStat.size };
    } catch {
      throw new NotFoundException("파일 본문을 찾을 수 없어요. 업로드 상태를 확인해 주세요");
    }
  }

  private rolesForPurpose(purpose: AssetPurpose) {
    if (purpose === AssetPurpose.SHOWCASE_IMAGE) return [ProductionRole.PRODUCER];
    if (purpose === AssetPurpose.MUSIC_TRACK) return MUSIC_EDIT_ROLES;
    if (purpose === AssetPurpose.SCRIPT_IMPORT || purpose === AssetPurpose.PERFORMANCE_MATERIAL) return SCRIPT_EDIT_ROLES;
    if (purpose === AssetPurpose.STAGE_EXPORT) return STAGE_EDIT_ROLES;
    if (purpose === AssetPurpose.RUN_SHEET_EXPORT) return VIEW_ROLES;
    if (purpose === AssetPurpose.CHECKLIST_EVIDENCE) return CHECKLIST_EVIDENCE_ROLES;
    if (purpose === AssetPurpose.BACKGROUND_VIDEO) return STAGE_EDIT_ROLES;
    if (purpose === AssetPurpose.CUE_MEDIA) return [...STAGE_EDIT_ROLES, ProductionRole.MUSIC_DIRECTOR];
    return VIEW_ROLES;
  }

  private resolveAssetKind(purpose: AssetPurpose, mimeType: string, policy: AssetPolicy) {
    if (purpose === AssetPurpose.STAGE_EXPORT && mimeType === "application/pdf") {
      return AssetKind.DOCUMENT;
    }
    if ((purpose === AssetPurpose.CHECKLIST_EVIDENCE || purpose === AssetPurpose.PERFORMANCE_MATERIAL) && mimeType.startsWith("image/")) {
      return AssetKind.IMAGE;
    }
    if (purpose === AssetPurpose.CUE_MEDIA) {
      return mimeType.startsWith("image/") ? AssetKind.IMAGE : mimeType.startsWith("audio/") ? AssetKind.AUDIO : AssetKind.VIDEO;
    }
    return policy.kind;
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    const active = await this.prisma.production.findFirst({ where: { id: productionId, deletedAt: null }, select: { id: true } });
    if (!active) throw new NotFoundException("공연을 찾을 수 없어요");
    await assertProductionMembership(this.prisma, user, productionId, roles, {
      forbiddenMessage: "이 파일 작업을 할 권한이 없어요"
    });
  }

  private isPersonalProfileImageAsset(asset: { productionId: string | null; kind: AssetKind; mime: string }) {
    return (
      asset.productionId === null &&
      asset.kind === AssetKind.IMAGE &&
      ["image/png", "image/jpeg", "image/webp"].includes(asset.mime)
    );
  }

  /** 현재 프로필 사진만 유효한 공동 공연의 참여자에게 공유한다. */
  private async sharesCurrentProfilePhoto(ownerId: string, viewerId: string, assetId: string) {
    const sharedMembership = await this.prisma.membership.findFirst({
      where: {
        userId: ownerId,
        user: { photoAssetId: assetId },
        production: {
          deletedAt: null,
          memberships: {
            some: { userId: viewerId }
          }
        }
      },
      select: { id: true }
    });
    return Boolean(sharedMembership);
  }

  private buildStorageKey(prefix: string, ownerScope: string, fileName: string) {
    const safeFileName = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
    return `${prefix}/${ownerScope}/${randomUUID()}-${safeFileName}`;
  }

  // 저장소 키에는 영문·숫자만 남긴다(원래 이름은 DB의 fileName에 있다). 한글 이름이 통째로 사라져도 확장자는 남긴다.
  private safeFileName(fileName: string) {
    const base = fileName.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    const extension = dot > 0 ? base.slice(dot).toLowerCase().replace(/[^a-z0-9.]+/g, "") : "";
    const stem = (dot > 0 ? base.slice(0, dot) : base).trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return `${stem || "file"}${extension}`;
  }

  /** 올리기·받기용 서명 주소. R2면 R2 직접 주소, 아니면 이 서버의 로컬 개발용 주소. */
  private async signedUrl(
    action: "upload" | "download",
    asset: { id: string; storageKey: string; mime: string; fileName?: string | null; sizeBytes: number },
    attachment = false
  ) {
    if (this.r2 && this.inR2(asset.storageKey)) {
      // 큰 영상은 올리는 데 시간이 걸리므로 올리기 주소는 더 오래 유효하다.
      const ttlSeconds = action === "upload" ? Number(this.config.get<string>("UPLOAD_URL_TTL") || 3600) : Number(this.config.get<string>("SIGNED_URL_TTL") || 600);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const url = action === "upload"
        ? await this.r2.presignUpload(asset.storageKey, asset.sizeBytes, ttlSeconds)
        : await this.r2.presignDownload(asset.storageKey, { mime: asset.mime, fileName: asset.fileName || "file", attachment }, ttlSeconds);
      return { method: action === "upload" ? "PUT" : "GET", url, expiresAt };
    }
    return this.buildSignedUrl(action, asset.id, asset.storageKey);
  }

  private buildSignedUrl(action: "upload" | "download", assetId: string, storageKey: string) {
    const ttlSeconds = Number(this.config.get<string>("SIGNED_URL_TTL") || 600);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const apiExternalUrl = (this.config.get<string>("API_EXTERNAL_URL") || "http://localhost:3000").replace(/\/+$/, "");
    const apiPrefix = (this.config.get<string>("API_PREFIX") || "/api/v1").replace(/^\/?/, "/").replace(/\/+$/, "");
    const signature = this.signObjectAction(action, assetId, storageKey, expiresAt.toISOString());

    return {
      method: action === "upload" ? "PUT" : "GET",
      url: `${apiExternalUrl}${apiPrefix}/assets/${assetId}/mock-object?action=${action}&expires=${encodeURIComponent(expiresAt.toISOString())}&signature=${signature}`,
      expiresAt: expiresAt.toISOString()
    };
  }

  private signObjectAction(action: "upload" | "download", assetId: string, storageKey: string, expires: string) {
    return createHash("sha256")
      .update(`${action}:${assetId}:${storageKey}:${expires}:${this.config.get<string>("JWT_ACCESS_SECRET") || "change-me"}`)
      .digest("hex");
  }

  private matchesSignature(received: string, expected: string) {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  }

  private assertAllowedFileType(dto: CreateAssetDto, policy: AssetPolicy) {
    const allowedExtensions = policy.allowedExtensionsByMime[dto.mimeType];
    if (!allowedExtensions) {
      throw new UnsupportedMediaTypeException("지원하지 않는 파일 형식이에요");
    }

    const extension = this.fileExtension(dto.fileName);
    if (!extension || !allowedExtensions.includes(extension)) {
      throw new UnsupportedMediaTypeException(`파일 확장자는 ${this.formatAllowedExtensions(policy)}만 가능해요`);
    }
  }

  private fileExtension(fileName: string) {
    const extension = path.extname(fileName.trim()).toLowerCase().replace(/^\./, "");
    return extension || null;
  }

  private formatAllowedExtensions(policy: AssetPolicy) {
    return unique(Object.values(policy.allowedExtensionsByMime).flat())
      .map((extension) => `.${extension}`)
      .join(", ");
  }

  private fileTooLargeException(maxBytes: number) {
    return new HttpException(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: "PAYLOAD_TOO_LARGE",
        message: `파일이 너무 커요(${this.formatBytes(maxBytes)} 이하만 가능해요)`
      },
      HttpStatus.PAYLOAD_TOO_LARGE
    );
  }

  private formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024) {
      return `${Math.floor(bytes / 1024 / 1024)}MB`;
    }
    if (bytes >= 1024) {
      return `${Math.floor(bytes / 1024)}KB`;
    }
    return `${bytes}B`;
  }

  private normalizeChecksum(value: string | null | undefined) {
    const trimmed = value?.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    const digest = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new BadRequestException("checksum은 sha256:<hex> 형식이어야 해요");
    }
    return `sha256:${digest}`;
  }

  private assertChecksumMatches(checksum: string | null, body: Buffer) {
    const normalized = this.normalizeChecksum(checksum);
    if (!normalized) {
      return;
    }
    const expectedDigest = normalized.slice("sha256:".length);
    const actualDigest = createHash("sha256").update(body).digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new BadRequestException("업로드 파일 checksum이 일치하지 않아요");
    }
  }

  private objectPath(assetId: string) {
    return path.join(this.objectDir(), `${assetId}.bin`);
  }

  private objectDir() {
    const configured = this.config.get<string>("ASSET_OBJECT_DIR")?.trim();
    if (configured) {
      return path.isAbsolute(configured) ? configured : path.resolve(this.backendRoot(), configured);
    }
    return path.join(this.backendRoot(), ".asset-objects");
  }

  private backendRoot() {
    let current = __dirname;
    for (let index = 0; index < 8; index += 1) {
      try {
        const packageJson = require(path.join(current, "package.json")) as { name?: string };
        if (packageJson.name === "reading-musical-api") {
          return current;
        }
      } catch {
        // Keep walking up until the backend package root is found.
      }
      current = path.dirname(current);
    }
    return process.cwd();
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}
