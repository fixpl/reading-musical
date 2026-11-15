type SharedProfileDetails = { specialties?: string[]; voiceRange?: string };

/** 임의 JSON과 개인 설정은 공유하지 않고 프로필 화면의 직무 정보만 투영한다. */
export function projectProfileDetails(value: unknown, visible: boolean): SharedProfileDetails | null {
  if (!visible || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const details: SharedProfileDetails = {};
  if (Array.isArray(source.specialties)) {
    const specialties = source.specialties.filter((item): item is string => typeof item === "string");
    if (specialties.length) details.specialties = specialties;
  }
  if (typeof source.voiceRange === "string" && source.voiceRange.trim()) details.voiceRange = source.voiceRange;
  return Object.keys(details).length ? details : null;
}
