import { BadRequestException, ConflictException } from "@nestjs/common";
import { ProductionRole } from "@prisma/client";

/**
 * productions 모듈 전체(핵심 서비스 + 분리된 멤버/포지션/스태프/디렉터리 서비스)가 공유하는
 * 순수 함수 모음. DB/HTTP에 의존하지 않아 별도 DI 없이 그대로 import해서 쓴다.
 */

export function requiredText(value: string | undefined, message: string): string {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException(message);
  }
  return text;
}

export function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export function assertDateRange(startDate: string | null | undefined, endDate: string | null | undefined): void {
  if (!startDate || !endDate) {
    return;
  }
  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    throw new BadRequestException("종료일은 시작일 이후여야 해요");
  }
}

export function titleTakenException(): ConflictException {
  return new ConflictException({
    code: "TITLE_TAKEN",
    field: "title",
    message: "같은 공연명이 있어요. 날짜·지역을 붙여 주세요"
  });
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) {
    return "***";
  }
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function takeSearch(value: number | undefined): number {
  const next = Number(value ?? 20);
  if (!Number.isFinite(next)) {
    return 20;
  }
  return Math.min(Math.max(Math.trunc(next), 1), 50);
}

export function searchSnippet(value: string | null | undefined, query: string): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }
  const normalizedQuery = query.toLowerCase();
  const index = text.toLowerCase().indexOf(normalizedQuery);
  if (index < 0) {
    return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  }
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + normalizedQuery.length + 90);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function normalizeRoles(nextRoles: ProductionRole[] | undefined, fallbackRoles: ProductionRole[]): ProductionRole[] {
  const roles = Array.from(new Set(nextRoles ?? fallbackRoles));
  if (roles.length === 0) {
    throw new BadRequestException("역할을 1개 이상 선택해 주세요");
  }
  return roles;
}

export function rolesChanged(beforeRoles: ProductionRole[], nextRoles: ProductionRole[]): boolean {
  const before = new Set(beforeRoles);
  const next = new Set(nextRoles);
  return before.size !== next.size || nextRoles.some((role) => !before.has(role));
}

const ROLE_LABELS: Record<ProductionRole, string> = {
  PRODUCER: "기획자",
  DIRECTOR: "연출자",
  MUSIC_DIRECTOR: "음악감독",
  STAGE_MANAGER: "무대감독",
  ACTOR: "배우",
  STAFF: "스태프",
  GUEST: "게스트"
};

export function roleLabel(role: ProductionRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function roleLabels(roles: ProductionRole[]): string {
  return roles.map((role) => roleLabel(role)).join(", ");
}
