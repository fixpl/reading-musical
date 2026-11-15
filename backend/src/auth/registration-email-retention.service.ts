import { Injectable } from "@nestjs/common";
import { Prisma, EmailDeliveryStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const BATCH_SIZE = 500;
const CHALLENGE_RETENTION_MS = 24 * 60 * 60_000;
const CODE_RETENTION_MS = 10 * 60_000;
const REDACTED_BODY = "인증번호 보관 기간 종료";
const ANONYMIZED_EMAIL = "expired-registration@example.invalid";
const ANONYMIZED_ERROR = "REGISTRATION_DATA_EXPIRED";
const SAFE_CODE_BODIES = ["인증번호 유효기간 종료", "인증번호 안내 발송 실패", "인증번호 안내 발송 완료", REDACTED_BODY];

@Injectable()
export class RegistrationEmailRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async purgeExpiredBatch() {
    const now = new Date();
    const expiredChallenge: Prisma.RegistrationEmailChallengeWhereInput = {
      createdAt: { lt: new Date(now.getTime() - CHALLENGE_RETENTION_MS) }, expiresAt: { lte: now },
      OR: [{ proofExpiresAt: null }, { proofExpiresAt: { lte: now } }]
    };
    // 시간당 발급 제한의 근거는 24시간 보존하고 코드와 proof가 모두 만료된 행만 제거한다.
    const challenges = await this.prisma.registrationEmailChallenge.findMany({
      where: expiredChallenge, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH_SIZE
    });
    const deleted = challenges.length ? (await this.prisma.registrationEmailChallenge.deleteMany({
      where: { ...expiredChallenge, id: { in: challenges.map((row) => row.id) } }
    })).count : 0;
    const expiredCode: Prisma.EmailDeliveryWhereInput = {
      templateKey: "auth.registration_code", createdAt: { lte: new Date(now.getTime() - CODE_RETENTION_MS) },
      bodyText: { notIn: SAFE_CODE_BODIES }
    };
    const deliveries = await this.prisma.emailDelivery.findMany({
      where: expiredCode, select: { id: true, status: true, updatedAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH_SIZE
    });
    let sanitized = 0;
    for (const delivery of deliveries) {
      const result = await this.prisma.emailDelivery.updateMany({
        where: { ...expiredCode, id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt },
        data: { bodyText: REDACTED_BODY, ...(delivery.status === EmailDeliveryStatus.QUEUED
          ? { status: EmailDeliveryStatus.SKIPPED, skippedReason: "CODE_EXPIRED_OR_USED", nextAttemptAt: null } : {}) }
      });
      // PROCESSING의 소유권·시도 횟수·시각은 건드리지 않는다. worker가 완료·복구 여부를 결정한다.
      sanitized += result.count;
    }
    const expiredDelivery: Prisma.EmailDeliveryWhereInput = {
      templateKey: "auth.registration_code", createdAt: { lt: new Date(now.getTime() - CHALLENGE_RETENTION_MS) },
      NOT: { status: EmailDeliveryStatus.PROCESSING, toEmail: ANONYMIZED_EMAIL, metadata: { equals: Prisma.DbNull },
        providerMessageId: null, bodyText: REDACTED_BODY, errorMessage: ANONYMIZED_ERROR }
    };
    const retainedDeliveries = await this.prisma.emailDelivery.findMany({
      where: expiredDelivery, select: { id: true, status: true, updatedAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH_SIZE
    });
    let deletedDeliveries = 0;
    let anonymized = 0;
    for (const delivery of retainedDeliveries) {
      const where: Prisma.EmailDeliveryWhereInput = { ...expiredDelivery, id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt };
      if (delivery.status === EmailDeliveryStatus.PROCESSING) {
        // 발송 소유권은 보존하고 수신 주소와 발송 자료만 비식별 값으로 바꾼다.
        const result = await this.prisma.emailDelivery.updateMany({ where, data: {
          toEmail: ANONYMIZED_EMAIL, metadata: Prisma.DbNull, providerMessageId: null, bodyText: REDACTED_BODY, errorMessage: ANONYMIZED_ERROR
        } });
        anonymized += result.count;
      } else {
        deletedDeliveries += (await this.prisma.emailDelivery.deleteMany({ where })).count;
      }
    }
    return { deleted, sanitized, deletedDeliveries, anonymized,
      moreMayRemain: challenges.length === BATCH_SIZE || deliveries.length === BATCH_SIZE || retainedDeliveries.length === BATCH_SIZE };
  }
}
