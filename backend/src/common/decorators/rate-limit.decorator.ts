import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "reading-musical:rate-limit";

export type RateLimitKeyMode = "ip" | "ip-body" | "user-or-ip";

export type RateLimitOptions = {
  name: string;
  defaultLimit: number;
  defaultWindowMs: number;
  limitEnv?: string;
  windowMsEnv?: string;
  keyMode?: RateLimitKeyMode;
};

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
