import { apiRequest, getAccessToken } from "./client";

export type MyProduction = {
  id: string;
  title: string;
  venue: string | null;
  startDate: string | null;
  currentPhase: string;
  visibility: string;
  canManageProduction?: boolean;
  myMembership?: { id: string; primaryRole: string; roles: string[] };
};

const PREP_ROLES = new Set(["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"]);

let cache: { at: number; token: string | null; items: MyProduction[] } | null = null;

export async function listMyProductions(options: { fresh?: boolean } = {}) {
  const token = getAccessToken();
  if (!options.fresh && cache && cache.token === token && Date.now() - cache.at < 30_000) {
    return cache.items;
  }
  const items = await apiRequest<MyProduction[]>("/productions");
  cache = { at: Date.now(), token, items };
  return items;
}

export async function getMyProduction(productionId: string) {
  const items = await listMyProductions();
  const found = items.find((item) => item.id === productionId);
  if (found) return found;
  // 승인 직후에는 30초 캐시에 새 공연이 없을 수 있어 한 번만 최신 목록을 확인한다.
  return (await listMyProductions({ fresh: true })).find((item) => item.id === productionId) ?? null;
}

export function isProductionStaff(production: MyProduction | null, platformRole?: string | null) {
  if (platformRole === "SUPER_ADMIN") {
    return true;
  }
  if (production?.canManageProduction !== undefined) return production.canManageProduction;
  const roles = production?.myMembership?.roles ?? [];
  return roles.some((role) => PREP_ROLES.has(role));
}
