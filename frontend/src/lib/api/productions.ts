import { apiRequest } from "./client";

export type MyProduction = {
  id: string;
  title: string;
  venue: string | null;
  startDate: string | null;
  currentPhase: string;
  visibility: string;
  myMembership?: { id: string; primaryRole: string; roles: string[] };
};

const PREP_ROLES = new Set(["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"]);

let cache: { at: number; items: MyProduction[] } | null = null;

export async function listMyProductions(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cache && Date.now() - cache.at < 30_000) {
    return cache.items;
  }
  const items = await apiRequest<MyProduction[]>("/productions");
  cache = { at: Date.now(), items };
  return items;
}

export async function getMyProduction(productionId: string) {
  const items = await listMyProductions();
  return items.find((item) => item.id === productionId) ?? null;
}

export function isProductionStaff(production: MyProduction | null, platformRole?: string | null) {
  if (platformRole === "SUPER_ADMIN" || platformRole === "ORG_ADMIN") {
    return true;
  }
  const roles = production?.myMembership?.roles ?? [];
  return roles.some((role) => PREP_ROLES.has(role));
}
