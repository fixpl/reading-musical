import type { Prisma } from "@prisma/client";

// Only these owner-requested bootstrap texts may be previewed on the development
// server. Never include arbitrary administrator drafts or future published versions.
export const INITIAL_POLICY_IDS: Readonly<Record<string, string>> = {
  TERMS: "7be11a9d-a4b3-47f4-881a-4f6dd851e101",
  PRIVACY_POLICY: "7be11a9d-a4b3-47f4-881a-4f6dd851e102",
  SIGNUP_PRIVACY: "7be11a9d-a4b3-47f4-881a-4f6dd851e103",
  OPTIONAL_PROFILE: "7be11a9d-a4b3-47f4-881a-4f6dd851e104",
  PROFILE_PRIVACY: "7be11a9d-a4b3-47f4-881a-4f6dd851e105",
  MARKETING_PRIVACY: "7be11a9d-a4b3-47f4-881a-4f6dd851e106",
  MARKETING_EMAIL: "7be11a9d-a4b3-47f4-881a-4f6dd851e107",
  INQUIRY_PRIVACY: "7be11a9d-a4b3-47f4-881a-4f6dd851e108"
};
export function initialPolicyPreviewWhere(): Prisma.LegalDocumentWhereInput {
  return {
    createdById: "system:site-bootstrap", version: 1, publishedAt: null,
    OR: Object.entries(INITIAL_POLICY_IDS).map(([kind, id]) => ({ kind, id }))
  };
}
