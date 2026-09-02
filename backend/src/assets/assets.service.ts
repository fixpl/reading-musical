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
import { isProductionAdmin } from "../common/access/is-production-admin";

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
    allowedMimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    allowedExtensionsByMime: {
      "video/mp4": ["mp4", "m4v"],
      "video/webm": ["webm"],
      "video/quicktime": ["mov"]
    },
    storagePrefix: "background"
  },
  [AssetPurpose.CUE_MEDIA]: {
    // 영상·음악 트랙 큐에 붙는 파일 — mime으로 VIDEO/AUDIO를 가린다(resolveAssetKind).
    kind: AssetKind.VIDEO,
    maxBytes: 500 * 1024 * 1024,
    allowedMimeTypes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/aac",
      "audio/x-m4a"
    ],
    allowedExtensionsByMime: {
      "video/mp4": ["mp4", "m4v"],
      "video/webm": ["webm"],
      "video/quicktime": ["mov"],
      "audio/mpeg": ["mp3"],
      "audio/mp3": ["mp3"],
      "audio/wav": ["wav"],
      "audio/x-wav": ["wav"],
      "audio/mp4": ["m4a", "mp4"],
      "audio/aac": ["aac"],
      "audio/x-m4a": ["m4a"]
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

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
    const storageKey = this.buildStorageKey(policy.storagePrefix, dto.productionId ?? user.id, dto.fileName);
    const checksum = this.normalizeChecksum(dto.checksum);
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: user.id,
        productionId: dto.productionId ?? null,
        kind,
        storageKey,
        mime: dto.mimeType,
        sizeBytes: dto.size,
        checksum
      }
    });

    return {
      asset,
      upload: this.buildSignedUrl("upload", asset.id, storageKey),
      download: this.buildSignedUrl("download", asset.id, storageKey),
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
      where: { productionId, kind: { in: [AssetKind.AUDIO, AssetKind.VIDEO] } },
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
        this.isPersonalProfileImageAsset(asset) && (await this.sharesProductionWithOwner(asset.ownerId, user.id));
      if (!canViewSharedProfilePhoto) {
        throw new ForbiddenException("이 파일을 볼 권한이 없어요");
      }
    }

    return {
      assetId: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      ...this.buildSignedUrl("download", asset.id, asset.storageKey)
    };
  }

  async assertMockObjectAccess(assetId: string, action: "upload" | "download", query: MockObjectSignatureQuery) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("파일을 찾을 수 없어요");
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

    const filePath = this.objectPath(assetId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return {
      assetId,
      stored: true,
      sizeBytes: body.length
    };
  }

  async readMockObject(assetId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("파일을 찾을 수 없어요");
    }

    const filePath = this.objectPath(assetId);
    try {
      const [body, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
      return { asset, body, sizeBytes: fileStat.size };
    } catch {
      throw new NotFoundException("업로드된 파일 본문을 찾을 수 없어요");
    }
  }

  private rolesForPurpose(purpose: AssetPurpose) {
    if (purpose === AssetPurpose.MUSIC_TRACK) return MUSIC_EDIT_ROLES;
    if (purpose === AssetPurpose.SCRIPT_IMPORT) return SCRIPT_EDIT_ROLES;
    if (purpose === AssetPurpose.STAGE_EXPORT) return STAGE_EDIT_ROLES;
    if (purpose === AssetPurpose.RUN_SHEET_EXPORT) return VIEW_ROLES;
    if (purpose === AssetPurpose.CHECKLIST_EVIDENCE) return CHECKLIST_EVIDENCE_ROLES;
    if (purpose === AssetPurpose.BACKGROUND_VIDEO) return STAGE_EDIT_ROLES;
    if (purpose === AssetPurpose.CUE_MEDIA) return STAGE_EDIT_ROLES;
    return VIEW_ROLES;
  }

  private resolveAssetKind(purpose: AssetPurpose, mimeType: string, policy: AssetPolicy) {
    if (purpose === AssetPurpose.STAGE_EXPORT && mimeType === "application/pdf") {
      return AssetKind.DOCUMENT;
    }
    if (purpose === AssetPurpose.CHECKLIST_EVIDENCE && mimeType.startsWith("image/")) {
      return AssetKind.IMAGE;
    }
    if (purpose === AssetPurpose.CUE_MEDIA) {
      return mimeType.startsWith("audio/") ? AssetKind.AUDIO : AssetKind.VIDEO;
    }
    return policy.kind;
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    if (await isProductionAdmin(this.prisma, user, productionId)) {
      return;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id, roles: { some: { role: { in: roles } } } },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException("이 파일 작업을 할 권한이 없어요");
    }
  }

  private isPersonalProfileImageAsset(asset: { productionId: string | null; kind: AssetKind; mime: string }) {
    return (
      asset.productionId === null &&
      asset.kind === AssetKind.IMAGE &&
      ["image/png", "image/jpeg", "image/webp"].includes(asset.mime)
    );
  }

  private async sharesProductionWithOwner(ownerId: string, viewerId: string) {
    const sharedMembership = await this.prisma.membership.findFirst({
      where: {
        userId: ownerId,
        production: {
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
