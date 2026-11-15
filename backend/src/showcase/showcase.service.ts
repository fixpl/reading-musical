import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AssetsService } from "../assets/assets.service";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { CREDIT_NOTICE_VERSION, SavePerformanceCreditDto, SaveShowcaseDto, type ShowcaseDocument } from "./dto";
import { normalizeShowcaseDocument, showcaseText } from "./showcase-document";

type Db = PrismaService | Prisma.TransactionClient;
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const CREDIT_INCLUDE = {
  creditConsent: true,
  roles: true,
  user: { select: { id: true, name: true, status: true, profileType: true, photoAssetId: true } },
  production: { select: { id: true, title: true, deletedAt: true, archived: true, showcase: { select: { publishedAt: true } } } },
  castAssignments: { include: { role: { select: { name: true, productionId: true } } } }
} satisfies Prisma.MembershipInclude;
type CreditMembership = Prisma.MembershipGetPayload<{ include: typeof CREDIT_INCLUDE }>;
type ShowcaseRow = Prisma.ProductionShowcaseGetPayload<Record<string, never>>;

@Injectable()
export class ShowcaseService {
  constructor(private readonly prisma: PrismaService, private readonly assets: AssetsService, private readonly config: ConfigService) {}

  async editor(productionId: string, user: RequestUser) {
    return this.schemaReady(async () => {
      const production = await this.assertManage(this.prisma, productionId, user);
      const row = await this.prisma.productionShowcase.findUnique({ where: { productionId } });
      return this.editorOutput(production, row, user);
    });
  }

  async save(productionId: string, dto: SaveShowcaseDto, user: RequestUser) {
    const document = normalizeShowcaseDocument(dto.draft);
    return this.schemaReady(async () => {
      await this.prisma.$transaction(async (tx) => {
        await this.lockProduction(tx, productionId);
        await this.assertManage(tx, productionId, user);
        const row = await tx.productionShowcase.findUnique({ where: { productionId } });
        this.assertRevision(row?.revision ?? 0, dto.expectedRevision);
        await this.assertDocumentAssets(tx, productionId, document);
        if (row) {
          await tx.productionShowcase.update({ where: { productionId }, data: { draft: this.json(document), revision: { increment: 1 } } });
        } else {
          await tx.productionShowcase.create({ data: { productionId, draft: this.json(document) } });
        }
      }, { timeout: 20000 });
      return this.editor(productionId, user);
    });
  }

  async publish(productionId: string, expectedRevision: number, user: RequestUser) {
    return this.schemaReady(async () => {
      await this.prisma.$transaction(async (tx) => {
        await this.lockProduction(tx, productionId);
        await this.assertManage(tx, productionId, user);
        const row = await tx.productionShowcase.findUnique({ where: { productionId } });
        this.assertRevision(row?.revision ?? 0, expectedRevision);
        if (!row) throw new BadRequestException("공연 소개를 먼저 저장해 주세요");
        const document = normalizeShowcaseDocument(row.draft);
        await this.assertDocumentAssets(tx, productionId, document);
        await tx.productionShowcase.update({ where: { productionId }, data: {
          published: this.json(document), publishedAt: new Date(), publishedById: user.id, revision: { increment: 1 }
        } });
      }, { timeout: 20000 });
      return this.editor(productionId, user);
    });
  }

  async unpublish(productionId: string, expectedRevision: number, user: RequestUser) {
    return this.schemaReady(async () => {
      await this.prisma.$transaction(async (tx) => {
        await this.lockProduction(tx, productionId);
        await this.assertManage(tx, productionId, user);
        const row = await tx.productionShowcase.findUnique({ where: { productionId } });
        this.assertRevision(row?.revision ?? 0, expectedRevision);
        if (row) await tx.productionShowcase.update({ where: { productionId }, data: {
          published: Prisma.DbNull, publishedAt: null, publishedById: null, revision: { increment: 1 }
        } });
      });
      return this.editor(productionId, user);
    });
  }

  async summaries(user: RequestUser) {
    if (user.platformRole !== "SUPER_ADMIN") throw new ForbiddenException("운영 관리자만 확인할 수 있어요");
    return this.schemaReady(async () => {
      const rows = await this.prisma.productionShowcase.findMany({ where: { production: { deletedAt: null, archived: false } }, orderBy: { updatedAt: "desc" } });
      return { items: await Promise.all(rows.map(async (row) => {
        const draft = normalizeShowcaseDocument(row.draft);
        return { productionId: row.productionId, posterUrl: await this.privateImageUrl(draft.posterAssetId, user), officialUrl: draft.officialUrl,
          publishedAt: row.publishedAt?.toISOString() ?? null, hasDraftChanges: this.hasDraftChanges(row), publicPath: this.publicPath(row.productionId) };
      })) };
    });
  }

  async listPublic(limit = 60, offset = 0) {
    return this.schemaReady(async () => {
      const take = Math.max(1, Math.min(60, Number.isInteger(limit) ? limit : 60));
      const skip = Math.max(0, Math.min(100000, Number.isInteger(offset) ? offset : 0));
      const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const where = { publishedAt: { not: null }, production: { deletedAt: null, archived: false } } satisfies Prisma.ProductionShowcaseWhereInput;
      const result = await this.prisma.$transaction(async (tx) => {
        const total = await tx.productionShowcase.count({ where });
        // 관객용 날짜만 사용한다. 종료일 미정인 과거 공연은 진행 중으로 추정하지 않는다.
        const ordered = await tx.$queryRaw<Array<{ productionId: string }>>`
          SELECT s.production_id AS "productionId"
          FROM production_showcases s JOIN productions p ON p.id = s.production_id
          WHERE s.published_at IS NOT NULL AND p.deleted_at IS NULL AND p.archived = false
          ORDER BY CASE
            WHEN s.published->>'endDate' >= ${today} OR s.published->>'startDate' >= ${today} THEN 0
            WHEN s.published->>'endDate' < ${today} THEN 2 ELSE 1 END,
            CASE WHEN s.published->>'endDate' < ${today} THEN s.published->>'endDate' END DESC NULLS LAST,
            s.published->>'startDate' ASC NULLS LAST, s.production_id ASC
          LIMIT ${take} OFFSET ${skip}`;
        const rows = ordered.length ? await tx.productionShowcase.findMany({ where: { ...where, productionId: { in: ordered.map((row) => row.productionId) } } }) : [];
        const byId = new Map(rows.map((row) => [row.productionId, row]));
        return { total, rows: ordered.flatMap((item) => { const row = byId.get(item.productionId); return row ? [row] : []; }) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { items: result.rows.map((row) => this.publicSummary(row.productionId, this.publishedDocument(row))), total: result.total, hasMore: skip + take < result.total, offset: skip };
    });
  }

  async detailPublic(productionId: string) {
    return this.schemaReady(async () => {
      const row = await this.publicRow(productionId);
      const document = this.publishedDocument(row);
      const credits = await this.prisma.membership.findMany({
        where: { productionId, creditConsent: { showName: true }, user: { status: "ACTIVE" }, roles: { some: { role: "ACTOR" } }, castAssignments: { some: { role: { productionId } } } },
        include: CREDIT_INCLUDE, orderBy: { createdAt: "asc" }
      });
      return { ...this.publicSummary(productionId, document), description: document.description,
        officialUrl: document.officialUrl, ticketUrl: document.ticketUrl, videoUrl: document.videoUrl,
        gallery: document.gallery.map((image, index) => ({ url: this.mediaUrl(productionId, `gallery/${index}`), caption: image.caption })),
        cast: credits.filter((membership) => this.eligible(membership) && membership.creditConsent?.showName && membership.creditConsent.noticeVersion === CREDIT_NOTICE_VERSION)
          .map((membership) => ({ displayName: membership.creditConsent!.displayName, roles: this.roleNames(membership),
            photoUrl: this.photoConsented(membership) ? this.mediaUrl(productionId, `credits/${membership.creditConsent!.id}/photo`) : null })) };
    });
  }

  async publicImage(productionId: string, kind: "poster" | "gallery" | "credit", indexOrCredit?: string) {
    return this.schemaReady(async () => {
      const row = await this.publicRow(productionId);
      const document = this.publishedDocument(row);
      if (kind === "credit") {
        const membership = await this.prisma.membership.findFirst({
          where: { productionId, creditConsent: { id: indexOrCredit } }, include: CREDIT_INCLUDE
        });
        if (!membership || !this.eligible(membership) || !this.photoConsented(membership)) throw this.notPublic();
        const image = await this.readImage(membership.creditConsent!.photoAssetId!, { ownerId: membership.user.id, personal: true });
        if (this.fingerprint(image.body) !== membership.creditConsent!.photoFingerprint) throw this.notPublic();
        // 파일을 읽는 동안 공개 철회/탈퇴/차단이 완료되었으면 응답하지 않는다.
        const current = await this.prisma.membership.findUnique({ where: { id: membership.id }, include: CREDIT_INCLUDE });
        await this.publicRow(productionId);
        if (!current || !this.eligible(current) || !this.photoConsented(current) || current.creditConsent!.revision !== membership.creditConsent!.revision) throw this.notPublic();
        return image;
      }
      const index = Number(indexOrCredit);
      const assetId = kind === "poster" ? document.posterAssetId
        : /^\d+$/.test(indexOrCredit ?? "") && Number.isSafeInteger(index) ? document.gallery[index]?.assetId : null;
      if (!assetId) throw this.notPublic();
      const image = await this.readImage(assetId, { productionId });
      const current = await this.publicRow(productionId);
      const currentDocument = this.publishedDocument(current);
      const currentAssetId = kind === "poster" ? currentDocument.posterAssetId : currentDocument.gallery[index]?.assetId;
      if (current.publishedAt?.getTime() !== row.publishedAt?.getTime() || currentAssetId !== assetId) throw this.notPublic();
      return image;
    });
  }

  async myCredits(user: RequestUser) {
    return this.schemaReady(async () => {
      const rows = await this.prisma.membership.findMany({
        where: { userId: user.id, production: { deletedAt: null, archived: false }, OR: [{ roles: { some: { role: "ACTOR" } } }, { creditConsent: { isNot: null } }] },
        include: CREDIT_INCLUDE, orderBy: { createdAt: "desc" }
      });
      return { items: await Promise.all(rows.map((row) => this.myCreditOutput(row, user))) };
    });
  }

  async saveCredit(productionId: string, dto: SavePerformanceCreditDto, user: RequestUser) {
    if (dto.noticeVersion !== CREDIT_NOTICE_VERSION) throw new ConflictException("출연진 공개 안내가 바뀌었어요. 새로고침한 뒤 확인해 주세요");
    if (dto.showPhoto && !dto.showName) throw new BadRequestException("사진을 공개하려면 이름 공개도 선택해 주세요");
    const displayName = showcaseText(dto.displayName, 80, "공개 이름", dto.showName);
    return this.schemaReady(async () => {
      await this.prisma.$transaction(async (tx) => {
        // 같은 공연의 동의를 직렬화하고 멤버 삭제와 경합해도 다른 사람의 동의를 만들지 않는다.
        await tx.$queryRaw`SELECT id FROM memberships WHERE production_id = ${productionId} AND user_id = ${user.id} FOR UPDATE`;
        const membership = await tx.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId } }, include: CREDIT_INCLUDE });
        if (!membership) throw new NotFoundException("참여 중인 공연을 찾을 수 없어요");
        const existing = membership.creditConsent;
        this.assertRevision(existing?.revision ?? 0, dto.expectedRevision);
        if (dto.showName && !this.eligible(membership)) throw new ForbiddenException("배역이 배정된 배우만 출연진 공개를 선택할 수 있어요");
        let photoAssetId: string | null = null;
        let photoFingerprint: string | null = null;
        if (dto.showPhoto) {
          photoAssetId = membership.user.photoAssetId;
          if (!photoAssetId) throw new BadRequestException("프로필에 사진을 먼저 등록해 주세요");
          const image = await this.readImage(photoAssetId, { ownerId: user.id, personal: true });
          photoFingerprint = this.fingerprint(image.body);
          const expectedToken = this.photoToken(user.id, photoAssetId, photoFingerprint);
          if (!dto.expectedPhotoToken || !this.sameToken(dto.expectedPhotoToken, expectedToken)) throw new ConflictException("프로필 사진이 바뀌었어요. 현재 사진을 다시 확인한 뒤 공개해 주세요");
        }
        const now = new Date();
        const data = { displayName, showName: dto.showName, showPhoto: dto.showPhoto, photoAssetId, photoFingerprint,
          noticeVersion: CREDIT_NOTICE_VERSION, consentedAt: dto.showName ? now : existing?.consentedAt ?? null,
          revokedAt: !dto.showName || (existing?.showPhoto && !dto.showPhoto) ? now : null };
        if (existing) await tx.performanceCreditConsent.update({ where: { membershipId: membership.id }, data: { ...data, revision: { increment: 1 } } });
        else await tx.performanceCreditConsent.create({ data: { ...data, membershipId: membership.id } });
      }, { timeout: 20000 });
      const saved = await this.prisma.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId } }, include: CREDIT_INCLUDE });
      if (!saved) throw new NotFoundException("참여 중인 공연을 찾을 수 없어요");
      return this.myCreditOutput(saved, user);
    });
  }

  private async assertManage(db: Db, productionId: string, user: RequestUser) {
    const production = await db.production.findFirst({ where: { id: productionId, deletedAt: null, archived: false } });
    if (!production) throw new NotFoundException("공연을 찾을 수 없어요");
    if (user.platformRole === "SUPER_ADMIN") return production;
    if (user.platformRole === "ORG_ADMIN") {
      const caller = await db.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
      if (caller?.organizationId === production.organizationId) return production;
    }
    const membership = await db.membership.findFirst({ where: { productionId, userId: user.id, roles: { some: { role: "PRODUCER" } } }, select: { id: true } });
    if (!membership) throw new ForbiddenException("공연 소개를 관리할 권한이 없어요");
    return production;
  }

  private async lockProduction(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM productions WHERE id = ${id} FOR UPDATE`;
  }

  private async editorOutput(production: { id: string; title: string; synopsis: string | null; description: string | null; venue: string | null; startDate: Date | null; endDate: Date | null }, row: ShowcaseRow | null, user: RequestUser) {
    const draft = row ? normalizeShowcaseDocument(row.draft) : normalizeShowcaseDocument({
      title: production.title, synopsis: production.synopsis ?? "", description: production.description ?? "", venue: production.venue ?? "",
      startDate: production.startDate?.toISOString().slice(0, 10) ?? null, endDate: production.endDate?.toISOString().slice(0, 10) ?? null,
      posterAssetId: null, officialUrl: "", ticketUrl: "", videoUrl: "", gallery: []
    });
    return { productionId: production.id, revision: row?.revision ?? 0, draft, published: row?.publishedAt ? normalizeShowcaseDocument(row.published) : null,
      publishedAt: row?.publishedAt?.toISOString() ?? null, hasDraftChanges: row ? this.hasDraftChanges(row) : false, publicPath: this.publicPath(production.id),
      posterUrl: await this.privateImageUrl(draft.posterAssetId, user), gallery: await Promise.all(draft.gallery.map(async (image) => ({
        assetId: image.assetId, caption: image.caption, url: (await this.privateImageUrl(image.assetId, user)) ?? ""
      }))) };
  }

  private hasDraftChanges(row: ShowcaseRow) { return row.publishedAt !== null && JSON.stringify(normalizeShowcaseDocument(row.draft)) !== JSON.stringify(normalizeShowcaseDocument(row.published)); }
  private publicPath(id: string) { return `/performances/${id}`; }
  private mediaUrl(id: string, suffix: string) {
    const base = (this.config.get<string>("API_EXTERNAL_URL") || "http://localhost:3000").replace(/\/+$/, "");
    const prefix = `/${(this.config.get<string>("API_PREFIX") || "/api/v1").replace(/^\/+|\/+$/g, "")}`;
    return `${base.endsWith(prefix) ? base : `${base}${prefix}`}/public/performances/${encodeURIComponent(id)}/${suffix}`;
  }
  private publicSummary(id: string, document: ShowcaseDocument) {
    return { slug: id, title: document.title, synopsis: document.synopsis, venue: document.venue, startDate: document.startDate, endDate: document.endDate,
      posterUrl: document.posterAssetId ? this.mediaUrl(id, "poster") : null };
  }
  private async publicRow(productionId: string) {
    const row = await this.prisma.productionShowcase.findFirst({ where: { productionId, publishedAt: { not: null }, production: { deletedAt: null, archived: false } } });
    if (!row) throw this.notPublic();
    return row;
  }
  private publishedDocument(row: ShowcaseRow) {
    if (!row.publishedAt || !row.published) throw this.notPublic();
    return normalizeShowcaseDocument(row.published);
  }
  private notPublic() { return new NotFoundException("공개된 공연 소개를 찾을 수 없어요"); }
  private async privateImageUrl(assetId: string | null, user: RequestUser) {
    if (!assetId) return null;
    try { return (await this.assets.getSignedUrl(assetId, user)).url; }
    catch (error) { if (error instanceof NotFoundException || error instanceof ForbiddenException) return null; throw error; }
  }
  private roleNames(membership: CreditMembership) { return [...new Set(membership.castAssignments.filter((assignment) => assignment.role.productionId === membership.productionId).map((assignment) => assignment.role.name))]; }
  private eligible(membership: CreditMembership) {
    return membership.user.status === "ACTIVE" && !membership.production.deletedAt && !membership.production.archived
      && membership.roles.some((role) => role.role === "ACTOR") && this.roleNames(membership).length > 0;
  }
  private photoConsented(membership: CreditMembership) {
    const consent = membership.creditConsent;
    return Boolean(consent?.showName && consent.showPhoto && consent.noticeVersion === CREDIT_NOTICE_VERSION && consent.photoAssetId && consent.photoFingerprint
      && consent.photoAssetId === membership.user.photoAssetId);
  }
  private async myCreditOutput(membership: CreditMembership, user: RequestUser) {
    const consent = membership.creditConsent;
    const photo = membership.user.photoAssetId ? await this.prisma.asset.findFirst({ where: { id: membership.user.photoAssetId, ownerId: user.id, productionId: null, kind: "IMAGE", mime: { in: IMAGE_MIMES } }, select: { id: true } }) : null;
    let photoToken: string | null = null;
    let currentFingerprint: string | null = null;
    if (photo) {
      try {
        const image = await this.readImage(photo.id, { ownerId: user.id, personal: true });
        currentFingerprint = this.fingerprint(image.body);
        photoToken = this.photoToken(user.id, photo.id, currentFingerprint);
      } catch (error) { if (!(error instanceof BadRequestException || error instanceof NotFoundException)) throw error; }
    }
    return { productionId: membership.productionId, productionTitle: membership.production.title, revision: consent?.revision ?? 0,
      displayName: consent?.displayName || membership.user.name, showName: consent?.showName ?? false,
      showPhoto: this.photoConsented(membership) && consent?.photoFingerprint === currentFingerprint,
      eligible: this.eligible(membership), roles: this.roleNames(membership), photoUrl: photo ? await this.privateImageUrl(photo.id, user) : null,
      hasProfilePhoto: Boolean(photo), published: Boolean(membership.production.showcase?.publishedAt) && !membership.production.deletedAt && !membership.production.archived,
      photoNeedsConfirmation: Boolean(consent?.showPhoto && (consent.photoAssetId !== membership.user.photoAssetId || consent.photoFingerprint !== currentFingerprint)),
      photoToken,
      noticeVersion: CREDIT_NOTICE_VERSION };
  }

  private async assertDocumentAssets(db: Db, productionId: string, document: ShowcaseDocument) {
    for (const id of new Set([document.posterAssetId, ...document.gallery.map((image) => image.assetId)].filter((value): value is string => Boolean(value)))) {
      const asset = await db.asset.findUnique({ where: { id } });
      this.assertImageAsset(asset, { productionId });
      await this.assets.assertStoredObject(asset!);
      await this.readImage(id, { productionId });
    }
  }
  private assertImageAsset(asset: { productionId: string | null; ownerId: string; kind: string; mime: string; sizeBytes: number; storageKey: string } | null, scope: { productionId?: string; ownerId?: string; personal?: boolean }) {
    if (!asset || asset.kind !== "IMAGE" || !IMAGE_MIMES.includes(asset.mime) || asset.sizeBytes <= 0 || asset.sizeBytes > MAX_IMAGE_BYTES) throw new BadRequestException("PNG, JPG, WebP 사진을 10MB 이하로 올려 주세요");
    if (scope.productionId && (asset.productionId !== scope.productionId || !this.assets.isShowcaseImageStorageKey(asset.storageKey))) throw new BadRequestException("이 공연의 홍보 사진으로 올린 파일만 사용할 수 있어요");
    if (scope.personal && (asset.productionId !== null || asset.ownerId !== scope.ownerId)) throw new BadRequestException("본인이 등록한 프로필 사진만 공개할 수 있어요");
  }
  private async readImage(id: string, scope: { productionId?: string; ownerId?: string; personal?: boolean }) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    this.assertImageAsset(asset, scope);
    const result = await this.assets.readMockObject(id);
    if (result.body.length !== asset!.sizeBytes || !this.matchesImage(result.body, asset!.mime)) throw new BadRequestException("사진 파일을 읽을 수 없어요. 파일을 다시 올려 주세요");
    if (asset!.checksum && asset!.checksum !== `sha256:${this.fingerprint(result.body)}`) throw new BadRequestException("사진 파일이 바뀌었어요. 파일을 다시 올려 주세요");
    return { body: result.body, mime: asset!.mime };
  }
  private matchesImage(body: Buffer, mime: string) {
    if (mime === "image/png") return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === "image/jpeg") return body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255;
    return mime === "image/webp" && body.length >= 12 && body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP";
  }
  private fingerprint(body: Buffer) { return createHash("sha256").update(body).digest("hex"); }
  private photoToken(userId: string, assetId: string, fingerprint: string) {
    return createHmac("sha256", this.config.get<string>("JWT_ACCESS_SECRET") || "local-showcase-photo")
      .update(JSON.stringify([userId, assetId, fingerprint, CREDIT_NOTICE_VERSION])).digest("hex");
  }
  private sameToken(received: string, expected: string) {
    const left = Buffer.from(received); const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  private json(document: ShowcaseDocument): Prisma.InputJsonValue { return document as unknown as Prisma.InputJsonValue; }
  private assertRevision(actual: number, expected: number) {
    if (!Number.isInteger(expected) || expected < 0) throw new BadRequestException("저장 버전을 확인해 주세요");
    if (actual !== expected) throw new ConflictException("다른 곳에서 내용이 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요");
  }
  private async schemaReady<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) throw new ServiceUnavailableException("공연 소개 저장 공간을 준비 중이에요. 운영 관리자에게 알려 주세요");
      throw error;
    }
  }
}
