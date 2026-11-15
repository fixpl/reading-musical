import { isDeepStrictEqual } from "node:util";

type OptionalProfile = {
  phone?: string | null;
  gender?: string | null;
  birthDate?: Date | string | null;
  address?: string | null;
  photoAssetId?: string | null;
  profileDetails?: unknown;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const normalizedDate = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : "";

// Removal, blanking and reordering must not require another grant of consent.
function addsValue(next: unknown, previous: unknown, depth = 0): boolean {
  if (next === undefined || next === null || next === "") return false;
  if (depth > 20) return true;
  if (typeof next === "string") return next.trim() !== "" && next.trim() !== (typeof previous === "string" ? previous.trim() : previous);
  if (Array.isArray(next)) {
    const old = Array.isArray(previous) ? previous : [];
    return next.some((item) => addsValue(item, undefined, depth + 1) && !old.some((value) => isDeepStrictEqual(value, item)));
  }
  if (typeof next === "object") {
    const old = record(previous);
    return Object.entries(record(next)).some(([key, value]) => addsValue(value, old[key], depth + 1));
  }
  return !isDeepStrictEqual(next, previous);
}

export function addsOptionalProfileData(next: OptionalProfile, previous: OptionalProfile): boolean {
  for (const key of ["phone", "address", "photoAssetId"] as const) {
    if (next[key] !== undefined && addsValue(next[key], previous[key])) return true;
  }
  if (next.gender && next.gender !== "UNSPECIFIED" && next.gender !== previous.gender) return true;
  if (next.birthDate && normalizedDate(next.birthDate) !== normalizedDate(previous.birthDate)) return true;
  if (next.profileDetails !== undefined && next.profileDetails !== null) {
    const { settings: _settings, ...nextDetails } = record(next.profileDetails);
    const { settings: _oldSettings, ...oldDetails } = record(previous.profileDetails);
    if (addsValue(nextDetails, oldDetails)) return true;
  }
  return false;
}
