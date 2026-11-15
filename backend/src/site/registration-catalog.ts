type DocumentRef = { id: string; kind: string; publishedAt: Date | null; effectiveAt: Date };

export function registrationReadiness(documents: ReadonlyArray<{ kind: string }>) {
  const has = (kind: string) => documents.some((doc) => doc.kind === kind);
  return {
    signup: ["TERMS", "PRIVACY_POLICY", "SIGNUP_PRIVACY"].every(has),
    optionalProfile: has("OPTIONAL_PROFILE"),
    marketing: has("MARKETING_PRIVACY") && has("MARKETING_EMAIL")
  };
}

// The same published-document contract applies in every runtime environment.
// DB revision/ID tracking is preserved; drafts never stand in for an agreement.
export function registrationCatalog<T extends DocumentRef>(documents: T[], now = new Date()) {
  const policies = documents.filter((doc) => doc.publishedAt !== null && doc.effectiveAt.getTime() <= now.getTime());
  return { policies, ready: registrationReadiness(policies) };
}
