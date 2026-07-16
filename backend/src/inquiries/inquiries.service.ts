import { Injectable, NotFoundException } from "@nestjs/common";
import { InquiryStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionsService } from "../productions/productions.service";
import type { RequestUser } from "../common/types/request-user";
import { AdminInquiryListQueryDto, ConvertInquiryDto, CreateInquiryDto, UpdateInquiryDto } from "./dto";

const INQUIRY_INCLUDE = {
  handledBy: { select: { id: true, name: true } },
  production: { select: { id: true, title: true } }
} satisfies Prisma.InquiryInclude;

const INQUIRY_DETAIL_INCLUDE = {
  handledBy: { select: { id: true, name: true } },
  production: { select: { id: true, title: true, currentPhase: true, visibility: true } },
  planningMemos: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true } }
    }
  }
} satisfies Prisma.InquiryInclude;

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productionsService: ProductionsService
  ) {}

  async create(dto: CreateInquiryDto) {
    const inquiry = await this.prisma.inquiry.create({
      data: {
        orgName: dto.orgName.trim(),
        contactName: dto.contactName.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        preferredTiming: dto.preferredTiming?.trim() || null,
        audience: dto.audience?.trim() || null,
        message: dto.message.trim()
      }
    });
    return { id: inquiry.id, createdAt: inquiry.createdAt };
  }

  async listForAdmin(query: AdminInquiryListQueryDto) {
    const [items, statusCounts] = await Promise.all([
      this.prisma.inquiry.findMany({
        where: query.status ? { status: query.status } : undefined,
        orderBy: { createdAt: "desc" },
        take: query.take ?? 50,
        include: INQUIRY_INCLUDE
      }),
      this.prisma.inquiry.groupBy({ by: ["status"], _count: { _all: true } })
    ]);

    const counts = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])) as Partial<
      Record<InquiryStatus, number>
    >;

    return { items, counts };
  }

  async getForAdmin(inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: INQUIRY_DETAIL_INCLUDE
    });
    if (!inquiry) {
      throw new NotFoundException("문의를 찾을 수 없습니다");
    }
    return inquiry;
  }

  async update(inquiryId: string, dto: UpdateInquiryDto, user: RequestUser) {
    const inquiry = await this.findOrThrow(inquiryId);

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiry.id },
      data: {
        status: dto.status ?? undefined,
        adminNote: dto.adminNote === undefined ? undefined : dto.adminNote.trim() || null,
        planningNote: dto.planningNote === undefined ? undefined : dto.planningNote.trim() || null,
        handledById: user.id
      },
      include: INQUIRY_DETAIL_INCLUDE
    });

    await this.writeLog(user, inquiry.id, "inquiry.update", {
      before: { status: inquiry.status, adminNote: inquiry.adminNote },
      after: { status: updated.status, adminNote: updated.adminNote }
    });

    return updated;
  }

  async convertToProduction(inquiryId: string, dto: ConvertInquiryDto, user: RequestUser) {
    const inquiry = await this.findOrThrow(inquiryId);

    const title = dto.title?.trim() || `${inquiry.orgName} 공연`;
    const production = await this.productionsService.create(
      {
        title,
        description: [
          `공연 신청 문의에서 시작된 공연입니다.`,
          `신청 기관: ${inquiry.orgName} (${inquiry.contactName})`,
          inquiry.preferredTiming ? `희망 시기: ${inquiry.preferredTiming}` : null,
          inquiry.audience ? `관람 대상: ${inquiry.audience}` : null
        ]
          .filter(Boolean)
          .join("\n")
      },
      user
    );

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiry.id },
      data: {
        status: InquiryStatus.CONVERTED,
        productionId: production.id,
        handledById: user.id
      },
      include: INQUIRY_INCLUDE
    });

    // 기획 단계에서 정리한 내용을 공연 기획 메모로 이관(있을 때).
    if (inquiry.planningNote?.trim()) {
      await this.prisma.planningMemo.create({
        data: {
          productionId: production.id,
          authorId: user.id,
          inquiryId: inquiry.id,
          body: inquiry.planningNote.trim()
        }
      });
    }

    await this.prisma.planningMemo.create({
      data: {
        productionId: production.id,
        authorId: user.id,
        inquiryId: inquiry.id,
        body: `신청 문의 원문\n연락처: ${inquiry.email}${inquiry.phone ? ` / ${inquiry.phone}` : ""}\n\n${inquiry.message}`
      }
    });

    await this.writeLog(user, inquiry.id, "inquiry.convert", {
      after: { productionId: production.id, title }
    });

    return { inquiry: updated, production: { id: production.id, title: production.title } };
  }

  private async findOrThrow(inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
    if (!inquiry) {
      throw new NotFoundException("문의를 찾을 수 없습니다");
    }
    return inquiry;
  }

  private async writeLog(
    user: RequestUser,
    inquiryId: string,
    action: string,
    payload: { before?: unknown; after?: unknown }
  ) {
    await this.prisma.activityLog.create({
      data: {
        actorId: user.id,
        action,
        entity: "Inquiry",
        entityId: inquiryId,
        beforeJson: payload.before === undefined ? undefined : (payload.before as Prisma.InputJsonValue),
        afterJson: payload.after === undefined ? undefined : (payload.after as Prisma.InputJsonValue)
      }
    });
  }
}
