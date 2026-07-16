import { apiRequest, clearTokens, getAccessToken } from "./client";

export type PlatformRole = "SUPER_ADMIN" | "ORG_ADMIN" | "MEMBER";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  profileType: string;
  profileComplete: boolean;
  platformRole: PlatformRole;
  photoAssetId?: string | null;
};

let cachedUser: CurrentUser | null = null;
let cachedToken: string | null = null;

export function isAdminRole(role: PlatformRole | undefined | null) {
  return role === "SUPER_ADMIN" || role === "ORG_ADMIN";
}

export function homePathFor(role: PlatformRole | undefined | null) {
  return isAdminRole(role) ? "/admin" : "/app";
}

export async function fetchCurrentUser(options: { fresh?: boolean } = {}) {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const token = getAccessToken();
  if (!token) {
    cachedUser = null;
    cachedToken = null;
    return null;
  }
  if (!options.fresh && cachedUser && cachedToken === token) {
    return cachedUser;
  }
  try {
    cachedUser = await apiRequest<CurrentUser>("/auth/me");
    cachedToken = token;
    return cachedUser;
  } catch {
    cachedUser = null;
    cachedToken = null;
    return null;
  }
}

export async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch {
    // 세션이 이미 만료된 경우에도 로컬 정리는 진행한다.
  }
  clearTokens();
  cachedUser = null;
  cachedToken = null;
}
