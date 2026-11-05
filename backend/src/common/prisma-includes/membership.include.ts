import type { Prisma } from "@prisma/client";

/**
 * Membership을 직렬화할 때 거의 모든 모듈이 공통으로 쓰는 필드 묶음.
 * schedule/run-sheets/reading-sessions 세 모듈이 각자 거의 동일한
 * membershipInclude()를 복붙해 보유하고 있었는데(진단 리포트 1-3),
 * schedule만 production·castAssignments를 추가로 포함해 같은 Membership이
 * API마다 다른 모양으로 응답되고 있었다. 공통 부분을 여기로 모으고,
 * 추가 필드가 필요한 모듈은 스프레드해서 확장한다.
 */
export const MEMBERSHIP_BASE_INCLUDE = {
  user: { select: { id: true, email: true, name: true, profileType: true, profileComplete: true } },
  roles: { select: { role: true } },
  staffAssignments: true
} satisfies Prisma.MembershipInclude;
