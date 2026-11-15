import { clearSwr } from "./swr";
import { apiRequest, clearTokens, getAccessToken } from "./client";
import { assertCurrentSession, captureSession, isCurrentSession, subscribeSession } from "./session";

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
subscribeSession(() => { cachedUser = null; cachedToken = null; });

export function isAdminRole(role: PlatformRole | undefined | null) {
  return role === "SUPER_ADMIN" || role === "ORG_ADMIN";
}

export function homePathFor(role: PlatformRole | undefined | null) {
  return role === "SUPER_ADMIN" ? "/admin" : "/app";
}

export async function fetchCurrentUser(options: { fresh?: boolean } = {}) {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const session = captureSession();
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
    const user = await apiRequest<CurrentUser>("/auth/me", { session });
    assertCurrentSession(session);
    cachedUser = user;
    cachedToken = getAccessToken();
    return cachedUser;
  } catch {
    if (isCurrentSession(session)) { cachedUser = null; cachedToken = null; }
    return null;
  }
}

export async function logout() {
  const session = captureSession();
  try {
    await apiRequest("/auth/logout", { method: "POST", session });
  } catch {
    // 세션이 이미 만료된 경우에도 로컬 정리는 진행한다.
  }
  if (clearTokens(session)) {
    clearSwr();
    cachedUser = null;
    cachedToken = null;
    return true;
  }
  return false;
}
