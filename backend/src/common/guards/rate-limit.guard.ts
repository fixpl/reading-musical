import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { RATE_LIMIT_KEY, type RateLimitKeyMode, type RateLimitOptions } from "../decorators/rate-limit.decorator";
import type { RequestUser } from "../types/request-user";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitedRequest = Request & {
  user?: RequestUser;
  body?: Record<string, unknown>;
};

const buckets = new Map<string, RateLimitBucket>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const limit = this.configInteger(options.limitEnv, options.defaultLimit, 1, 10000);
    const windowMs = this.configInteger(options.windowMsEnv, options.defaultWindowMs, 1000, 86_400_000);
    const now = Date.now();
    const key = `${options.name}:${this.keySubject(request, options.keyMode ?? "ip")}`;
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowMs } : existing;

    bucket.count += 1;
    buckets.set(key, bucket);
    this.cleanupExpired(now);

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    response.setHeader("X-RateLimit-Limit", String(limit));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      response.setHeader("Retry-After", String(retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: "RATE_LIMITED",
          message: "잠시 후 다시 시도해 주세요",
          retryAfterSeconds
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    return true;
  }

  private configInteger(envKey: string | undefined, fallback: number, min: number, max: number) {
    const raw = envKey ? this.config.get<string>(envKey) : undefined;
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }

  private keySubject(request: RateLimitedRequest, mode: RateLimitKeyMode) {
    const ip = this.clientIp(request);
    if (mode === "ip") {
      return `ip:${this.hash(ip)}`;
    }
    if (mode === "user-or-ip") {
      return request.user?.id ? `user:${request.user.id}` : `ip:${this.hash(ip)}`;
    }
    return `ip:${this.hash(ip)}:body:${this.hash(this.bodySubject(request))}`;
  }

  private bodySubject(request: RateLimitedRequest) {
    const body = request.body ?? {};
    const candidate = body.email ?? body.token ?? body.q ?? "";
    return typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
  }

  private clientIp(request: Request) {
    // X-Forwarded-For는 신뢰할 수 있는 프록시 뒤에서만 사용 — 클라이언트가 임의 값으로 버킷을 우회하지 못하게 한다.
    if (this.config.get<string>("RATE_LIMIT_TRUST_PROXY") === "true") {
      const forwardedFor = request.headers["x-forwarded-for"];
      const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0];
      if (firstForwarded?.trim()) {
        return firstForwarded.trim();
      }
    }
    return (request.ip || request.socket.remoteAddress || "unknown").trim();
  }

  private cleanupExpired(now: number) {
    if (buckets.size < 10000) {
      return;
    }
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  private hash(value: string) {
    return createHash("sha256").update(value || "unknown").digest("hex").slice(0, 24);
  }
}
