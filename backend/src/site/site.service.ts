import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { registrationCatalog } from "./registration-catalog";
import { assertMarketingSelection, assertPublishable, LEGAL_KINDS, publicSiteInfo, requireCurrentDocument, SITE_SETTING_KEY } from "./site-policy";
import type { FaqCategoryDto, FaqQuestionDto, InquiryConsentDto, MarketingConsentDto, RegistrationConsentDto, SaveLegalDocumentDto, SaveSiteSettingsDto } from "./site.dto";

type Db = Prisma.TransactionClient;
const documentSummary = { id: true, kind: true, version: true, title: true, effectiveAt: true, publishedAt: true, purpose: true, items: true, retention: true, refusal: true } satisfies Prisma.LegalDocumentSelect;
const consentUser = { id: true, email: true, marketingPrivacy: true, marketingEmail: true, marketingRevision: true, marketingUpdatedAt: true } satisfies Prisma.UserSelect;
const changed = () => new ConflictException("다른 작업에서 내용이 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
const isConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);

@Injectable()
export class SiteService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(db: Db = this.prisma) {
    const record = await db.systemSetting.findUnique({ where: { key: SITE_SETTING_KEY } });
    const value = record?.value && typeof record.value === "object" && !Array.isArray(record.value) ? record.value as Record<string, Prisma.JsonValue> : {};
    return { info: publicSiteInfo(value.info), revision: Number.isInteger(value.revision) ? Number(value.revision) : 0 };
  }

  async publicInfo() {
    const settings = await this.settings();
    let policies: Prisma.LegalDocumentGetPayload<{ select: typeof documentSummary }>[] = [];
    let setupRequired = !this.prisma.legalDocument;
    if (!setupRequired) {
      try {
        policies = await this.prisma.legalDocument.findMany({ where: { publishedAt: { not: null }, effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }], distinct: ["kind"], select: documentSummary });
      } catch (error) {
        // Only an incomplete schema upgrade has a controlled fallback. Network/database
        // failures still propagate; a cached or fabricated policy must never enable signup.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code))) throw error;
        setupRequired = true;
      }
    }
    const has = (kind: string) => policies.some((doc) => doc.kind === kind);
    const registration = registrationCatalog(policies);
    return { info: settings.info, policies, registration, setupRequired, ready: { signup: ["TERMS", "PRIVACY_POLICY", "SIGNUP_PRIVACY"].every(has), inquiry: has("PRIVACY_POLICY") && has("INQUIRY_PRIVACY"), optionalProfile: has("OPTIONAL_PROFILE"), marketing: has("MARKETING_PRIVACY") && has("MARKETING_EMAIL") } };
  }

  private policyClient(db: Db = this.prisma) {
    if (!db.legalDocument) throw new ServiceUnavailableException({ code: "SITE_SETUP_REQUIRED", message: "요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." });
    return db.legalDocument;
  }

  async saveSettings(dto: SaveSiteSettingsDto, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const old = await tx.systemSetting.findUnique({ where: { key: SITE_SETTING_KEY } });
        const current = await this.settings(tx);
        if (current.revision !== dto.revision) throw changed();
        const value = { info: publicSiteInfo(dto.info), revision: current.revision + 1 };
        if (old) {
          const result = await tx.systemSetting.updateMany({ where: { key: SITE_SETTING_KEY, value: { equals: old.value === null ? Prisma.JsonNull : old.value } }, data: { value, updatedById: actorId } });
          if (result.count !== 1) throw changed();
        } else {
          await tx.systemSetting.create({ data: { key: SITE_SETTING_KEY, value, valueType: "JSON", description: "공개 사이트 정보 (비밀키 저장 금지)", updatedById: actorId } });
        }
        await this.audit(tx, actorId, "site.settings.update", "SystemSetting", SITE_SETTING_KEY);
        return value;
      });
    } catch (error) { if (isConflict(error)) throw changed(); throw error; }
  }

  currentDocuments(db: Db = this.prisma) {
    return this.policyClient(db).findMany({ where: { publishedAt: { not: null }, effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }], distinct: ["kind"] });
  }

  async publicDocument(kind: string, id?: string, preview = false) {
    if (!(LEGAL_KINDS as readonly string[]).includes(kind)) throw new NotFoundException("문서를 찾을 수 없습니다.");
    // Old preview URLs must not expose unpublished documents after the rollout.
    if (preview) throw new NotFoundException("문서를 찾을 수 없습니다.");
    const where = { kind, publishedAt: { not: null }, effectiveAt: { lte: new Date() } };
    const document = await this.policyClient().findFirst({ where: { ...where, ...(id ? { id } : {}) }, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }] });
    if (!document) throw new NotFoundException("아직 공개된 문서가 없습니다.");
    const history = await this.prisma.legalDocument.findMany({ where, orderBy: [{ effectiveAt: "desc" }, { version: "desc" }], take: 100, select: { id: true, version: true, title: true, effectiveAt: true } });
    const { createdById: _actor, ...publicDocument } = document;
    return { document: publicDocument, history };
  }

  async adminDocuments(kind: string) {
    this.policyClient();
    if (!(LEGAL_KINDS as readonly string[]).includes(kind)) throw new BadRequestException("문서 종류를 확인해 주세요.");
    const [latest, history] = await Promise.all([
      this.prisma.legalDocument.findFirst({ where: { kind }, orderBy: { version: "desc" } }),
      this.prisma.legalDocument.findMany({ where: { kind }, orderBy: { version: "desc" }, take: 100, select: documentSummary })
    ]);
    return { latest, history };
  }

  async adminDocument(id: string) {
    this.policyClient();
    const document = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!document) throw new NotFoundException("문서를 찾을 수 없습니다.");
    return document;
  }

  async saveDocument(dto: SaveLegalDocumentDto, actorId: string) {
    this.policyClient();
    if (dto.publish) assertPublishable(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.legalDocument.findFirst({ where: { kind: dto.kind }, orderBy: { version: "desc" }, select: { version: true } });
        if ((last?.version ?? 0) !== dto.expectedVersion) throw changed();
        const document = await tx.legalDocument.create({ data: {
          kind: dto.kind, version: (last?.version ?? 0) + 1, title: dto.title.trim(), body: dto.body.trim(), purpose: dto.purpose.trim(), items: dto.items.trim(), retention: dto.retention.trim(), refusal: dto.refusal.trim(),
          effectiveAt: new Date(dto.effectiveAt), publishedAt: dto.publish ? new Date() : null, createdById: actorId
        } });
        await this.audit(tx, actorId, dto.publish ? "site.policy.publish" : "site.policy.draft", "LegalDocument", document.id);
        return document;
      });
    } catch (error) { if (isConflict(error)) throw changed(); throw error; }
  }

  async registrationConsents(dto: RegistrationConsentDto, phone: string | undefined, db: Db) {
    if (dto?.terms !== true || dto?.privacy !== true || dto?.age14 !== true) throw new BadRequestException("필수 약관과 만 14세 이상 여부를 확인해 주세요.");
    if (dto.mode !== undefined && dto.mode !== "published") {
      throw new ConflictException({ code: "POLICY_CHANGED", message: "가입 정보를 새로 불러온 뒤 다시 확인해 주세요." });
    }
    const { policies: documents } = registrationCatalog(await this.currentDocuments(db));
    const source = "REGISTER";
    if (!documents.some((doc) => doc.kind === "PRIVACY_POLICY")) throw new ServiceUnavailableException({ code: "POLICY_NOT_READY", message: "개인정보 처리방침을 준비 중입니다." });
    const terms = requireCurrentDocument(documents, "TERMS", dto.termsDocumentId);
    const privacy = requireCurrentDocument(documents, "SIGNUP_PRIVACY", dto.privacyDocumentId);
    const marketingPrivacy = dto.marketingPrivacy === true;
    const marketing = dto.marketing === true;
    assertMarketingSelection(marketingPrivacy, marketing);
    const events: Prisma.ConsentEventCreateManyUserInput[] = [
      { kind: "TERMS", granted: true, documentId: terms.id, source },
      { kind: "SIGNUP_PRIVACY", granted: true, documentId: privacy.id, source },
      { kind: "AGE_14", granted: true, documentId: terms.id, source }
    ];
    if (phone?.trim() || dto.optionalProfile === true) {
      if (dto.optionalProfile !== true) throw new BadRequestException("연락처를 입력하려면 선택 개인정보 수집에 동의하거나 연락처를 비워 주세요.");
      const optional = requireCurrentDocument(documents, "OPTIONAL_PROFILE", dto.optionalProfileDocumentId);
      events.push({ kind: "OPTIONAL_PROFILE", granted: true, documentId: optional.id, source });
    }
    for (const [kind, granted, suppliedId] of [["MARKETING_PRIVACY", marketingPrivacy, dto.marketingPrivacyDocumentId], ["MARKETING_EMAIL", marketing, dto.marketingEmailDocumentId]] as const) {
      const doc = granted ? requireCurrentDocument(documents, kind, suppliedId) : documents.find((item) => item.kind === kind);
      events.push({ kind, granted, documentId: doc?.id, source });
    }
    return { events, marketingPrivacy, marketingEmail: marketing };
  }

  async inquiryConsent(dto: InquiryConsentDto, db: Db = this.prisma) {
    if (dto.website?.trim()) throw new BadRequestException("문의를 접수하지 못했습니다.");
    if (dto.privacyConsent !== true || dto.age14 !== true) throw new BadRequestException("문의 개인정보 수집 동의와 만 14세 이상 여부를 확인해 주세요.");
    const docs = await this.currentDocuments(db);
    if (!docs.some((doc) => doc.kind === "PRIVACY_POLICY")) throw new ServiceUnavailableException({ code: "POLICY_NOT_READY", message: "개인정보 처리방침을 준비 중입니다." });
    return requireCurrentDocument(docs, "INQUIRY_PRIVACY", dto.privacyDocumentId);
  }

  async recordProfileConsent(
    userId: string,
    dto: { profilePrivacyConsent?: boolean; profilePrivacyDocumentId?: string },
    source: "PROFILE_UPDATE" | "PROFILE_PHOTO",
    db: Db = this.prisma
  ) {
    if (dto.profilePrivacyConsent !== true) throw new BadRequestException("새 선택 프로필 정보를 저장하려면 수집·이용 안내를 확인하고 동의해 주세요. 기존 정보를 지우거나 기본 정보만 변경할 때는 필요하지 않습니다.");
    const documents = await this.currentDocuments(db);
    if (!documents.some((doc) => doc.kind === "PRIVACY_POLICY")) throw new ServiceUnavailableException({ code: "POLICY_NOT_READY", message: "개인정보 처리방침을 준비 중입니다." });
    // 가입 시 연락처에 동의한 사실을 생년월일·지역·사진 등의 동의로 확대하지 않는다.
    const document = requireCurrentDocument(documents, "PROFILE_PRIVACY", dto.profilePrivacyDocumentId);
    await db.consentEvent.create({ data: { userId, kind: "PROFILE_PRIVACY", granted: true, documentId: document.id, source } });
  }

  async myConsents(userId: string) {
    const [user, history] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: consentUser }),
      this.prisma.consentEvent.findMany({ where: { userId, source: { in: ["REGISTER", "PREFERENCES", "PROFILE_UPDATE", "PROFILE_PHOTO"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, kind: true, granted: true, source: true, createdAt: true, document: { select: { id: true, title: true, kind: true, version: true } } } })
    ]);
    return { marketingPrivacy: user.marketingPrivacy, marketing: user.marketingEmail, revision: user.marketingRevision, updatedAt: user.marketingUpdatedAt, history };
  }

  async updateMarketing(userId: string, dto: MarketingConsentDto) {
    assertMarketingSelection(dto.marketingPrivacy, dto.marketing);
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: consentUser });
      if (user.marketingRevision !== dto.revision) throw changed();
      if (user.marketingPrivacy === dto.marketingPrivacy && user.marketingEmail === dto.marketing) return;
      const documents = await this.currentDocuments(tx);
      const changes: Prisma.ConsentEventCreateManyInput[] = [];
      for (const [kind, before, after, id] of [
        ["MARKETING_PRIVACY", user.marketingPrivacy, dto.marketingPrivacy, dto.marketingPrivacyDocumentId],
        ["MARKETING_EMAIL", user.marketingEmail, dto.marketing, dto.marketingEmailDocumentId]
      ] as const) {
        if (before === after) continue;
        // 철회는 신규 문서 공개 여부에 관계없이 허용한다.
        const doc = after ? requireCurrentDocument(documents, kind, id) : documents.find((item) => item.kind === kind);
        changes.push({ userId, kind, granted: after, documentId: doc?.id, source: "PREFERENCES" });
      }
      const now = new Date();
      const updated = await tx.user.updateMany({ where: { id: userId, marketingRevision: dto.revision }, data: { marketingPrivacy: dto.marketingPrivacy, marketingEmail: dto.marketing, marketingRevision: { increment: 1 }, marketingUpdatedAt: now } });
      if (updated.count !== 1) throw changed();
      await tx.consentEvent.createMany({ data: changes });
      await this.queueConsentReceipt(tx, { id: user.id, email: user.email }, dto.marketingPrivacy, dto.marketing, now);
    });
    return this.myConsents(userId);
  }

  async queueConsentReceipt(tx: Db, user: { id: string; email: string }, privacy: boolean, email: boolean, now = new Date()) {
    const { info } = await this.settings(tx);
    await tx.emailDelivery.create({ data: {
      userId: user.id, toEmail: user.email, subject: "마케팅 동의 설정 처리 결과", templateKey: "site.consent_receipt", status: "QUEUED",
      bodyText: [info.companyName || info.siteName, "", `처리 일시: ${now.toISOString()}`, `마케팅 목적 개인정보 이용: ${privacy ? "동의" : "동의하지 않음 / 철회"}`, `이메일 광고성 정보 수신: ${email ? "동의" : "동의하지 않음 / 철회"}`, "", "사이트의 ‘수신 동의 관리’에서 언제든지 변경할 수 있습니다.", "이 메일은 설정 처리 결과를 알리는 서비스 안내이며 광고가 아닙니다."].join("\n"),
      metadata: { transactional: true, marketingRevisionNotice: true }
    } });
  }

  faqs(admin = false) {
    if (!this.prisma.faqCategory) throw new ServiceUnavailableException({ code: "SITE_SETUP_REQUIRED", message: "질문 목록을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." });
    return this.prisma.faqCategory.findMany({ where: admin ? {} : { active: true, questions: { some: { active: true } } }, orderBy: [{ order: "asc" }, { name: "asc" }], take: 200,
      include: { questions: { where: admin ? {} : { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 500 } } });
  }

  async saveCategory(dto: FaqCategoryDto, actorId: string, id?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const data = { name: dto.name.trim(), order: dto.order, active: dto.active };
        let result;
        if (id) {
          if (!dto.revision) throw changed();
          const update = await tx.faqCategory.updateMany({ where: { id, revision: dto.revision }, data: { ...data, revision: { increment: 1 } } });
          if (update.count !== 1) throw changed();
          result = await tx.faqCategory.findUniqueOrThrow({ where: { id } });
        } else result = await tx.faqCategory.create({ data });
        await this.audit(tx, actorId, "site.faq.category.save", "FaqCategory", result.id);
        return result;
      });
    } catch (error) { if (isConflict(error)) throw new ConflictException("같은 이름의 카테고리가 있거나 내용이 변경되었습니다."); throw error; }
  }

  async saveQuestion(dto: FaqQuestionDto, actorId: string, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!await tx.faqCategory.findUnique({ where: { id: dto.categoryId } })) throw new BadRequestException("카테고리를 먼저 등록해 주세요.");
      const data = { categoryId: dto.categoryId, title: dto.title.trim(), body: dto.body.trim(), order: dto.order, active: dto.active };
      let result;
      if (id) {
        if (!dto.revision) throw changed();
        const update = await tx.faqQuestion.updateMany({ where: { id, revision: dto.revision }, data: { ...data, revision: { increment: 1 } } });
        if (update.count !== 1) throw changed();
        result = await tx.faqQuestion.findUniqueOrThrow({ where: { id } });
      } else result = await tx.faqQuestion.create({ data });
      await this.audit(tx, actorId, "site.faq.question.save", "FaqQuestion", result.id);
      return result;
    });
  }

  async audit(tx: Db, actorId: string, action: string, entity: string, entityId: string) {
    // 공개 문서 원문이나 문의 개인정보를 활동 로그에 중복 저장하지 않는다.
    await tx.activityLog.create({ data: { actorId, action, entity, entityId } });
  }
}
