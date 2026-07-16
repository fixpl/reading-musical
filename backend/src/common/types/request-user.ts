import type { PlatformRole } from "@prisma/client";

export type RequestUser = {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
};
