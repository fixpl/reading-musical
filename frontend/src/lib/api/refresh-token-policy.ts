const REFRESH_TOKEN_STORAGE_ALLOWED_ENVS = new Set(["development", "local", "test"]);

export function canStoreRefreshToken(publicStoreRefreshToken: string | undefined, publicAppEnv: string | undefined) {
  if (publicStoreRefreshToken !== "true") {
    return false;
  }
  const appEnv = (publicAppEnv || "").trim().toLowerCase();
  return REFRESH_TOKEN_STORAGE_ALLOWED_ENVS.has(appEnv);
}
