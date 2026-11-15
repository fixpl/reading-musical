import type { ProductionAccess } from "$lib/api/production-access";

export type WorkspaceIcon = "house" | "calendar" | "search" | "clipboard" | "bell" | "user" | "shield" | "message" | "book" | "notebook" | "music" | "mic" | "users" | "checks" | "userCog" | "settings";
export type WorkspaceMenuItem = { title: string; url: string; icon: WorkspaceIcon; exact?: boolean };

export const WORKSPACE_MENU: WorkspaceMenuItem[] = [
  { title: "내 공연", url: "/app", icon: "house", exact: true },
  { title: "내 일정", url: "/app/schedule", icon: "calendar" },
  { title: "참여할 공연 찾기", url: "/app/opportunities", icon: "search" },
  { title: "내 지원 현황", url: "/app/applications", icon: "clipboard" },
  { title: "알림", url: "/app/notifications", icon: "bell" },
  { title: "프로필", url: "/app/profile", icon: "user" }
];
export const WORKSPACE_SUPPORT_MENU: WorkspaceMenuItem[] = [
  { title: "수신 동의 관리", url: "/app/privacy", icon: "shield" },
  { title: "운영팀 문의", url: "/support", icon: "message" },
  { title: "자주 묻는 질문", url: "/faq", icon: "book" }
];

/** 메뉴 표시는 접근 제어를 대신하지 않는다. 쓰기 메뉴는 각 기능의 서버 capability를 따른다. */
export function productionNavigation(pid: string | null, access: ProductionAccess, prioritizeCueSheet: boolean) {
  if (!pid) return { production: [], manage: [], mobile: WORKSPACE_MENU
    .filter((item) => ["/app", "/app/schedule", "/app/opportunities", "/app/notifications"].includes(item.url))
    .map((item) => item.url === "/app/opportunities" ? { ...item, title: "모집 찾기" } : item) };
  const base = `/app/p/${pid}`;
  const home: WorkspaceMenuItem = { title: "공연 홈", url: base, icon: "clipboard", exact: true };
  const composition: WorkspaceMenuItem = { title: "대본·자료", url: `${base}/composition`, icon: "notebook" };
  const cuesheet: WorkspaceMenuItem = { title: "큐시트", url: `${base}/cuesheet`, icon: "music" };
  const reading: WorkspaceMenuItem = { title: "대본 읽기", url: `${base}/script`, icon: "book" };
  const rehearsal: WorkspaceMenuItem = { title: "개인 연습", url: `${base}/live`, icon: "mic" };
  const team: WorkspaceMenuItem[] = [
    { title: "일정", url: `${base}/schedule`, icon: "calendar" },
    { title: "공연팀", url: `${base}/people`, icon: "users" },
    { title: "팀 게시판", url: `${base}/board`, icon: "message" }
  ];
  const production = access.canManageTracks ? [home, composition, cuesheet, rehearsal, reading, ...team]
    : prioritizeCueSheet ? [home, cuesheet, rehearsal, reading, ...team, composition]
      : [home, reading, rehearsal, ...team, cuesheet, composition];
  const manage: WorkspaceMenuItem[] = [
    ...(access.canEditChecklist ? [{ title: "준비 체크리스트", url: `${base}/checklist`, icon: "checks" as const }] : []),
    ...(access.canEditPlanning ? [{ title: "기획 메모", url: `${base}/manage/planning`, icon: "notebook" as const }] : []),
    ...(access.canEditCasting ? [{ title: "캐스팅", url: `${base}/manage/casting`, icon: "mic" as const }] : []),
    ...(access.canViewMembers ? [{ title: "멤버", url: `${base}/manage/members`, icon: "userCog" as const }] : []),
    ...(access.canManageRecruitment ? [{ title: "배우·스태프 모집", url: `${base}/manage/recruitment`, icon: "users" as const }] : []),
    ...(access.canEditProduction ? [{ title: "공연 설정", url: `${base}/manage/settings`, icon: "settings" as const }] : [])
  ];
  const mobile: WorkspaceMenuItem[] = [{ ...home, icon: "house" }, access.canManageTracks ? composition : prioritizeCueSheet ? cuesheet : reading, rehearsal, team[0], team[2]];
  return { production, manage, mobile };
}

export function isWorkspaceMenuActive(pathname: string, item: WorkspaceMenuItem) {
  return item.exact ? pathname === item.url : pathname.startsWith(item.url);
}

export function workspaceTitle(pathname: string, pid: string | null, production: WorkspaceMenuItem[], manage: WorkspaceMenuItem[]) {
  const items = pid ? [...production, ...manage] : [...WORKSPACE_MENU, ...WORKSPACE_SUPPORT_MENU];
  return items.find((item) => isWorkspaceMenuActive(pathname, item))?.title ?? (pid ? "공연" : "홈");
}
