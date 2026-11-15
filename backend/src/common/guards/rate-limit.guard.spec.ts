import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard";

function context(headers: Record<string, string>, ip: string) {
  const response = { setHeader: jest.fn() };
  const request = { headers, ip, socket: { remoteAddress: ip } };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
  } as unknown as ExecutionContext;
}

function guard(name: string) {
  const reflector = { getAllAndOverride: () => ({ name, defaultLimit: 2, defaultWindowMs: 60_000 }) } as unknown as Reflector;
  const config = { get: (key: string) => (key === "RATE_LIMIT_TRUST_PROXY" ? "true" : undefined) } as unknown as ConfigService;
  return new RateLimitGuard(reflector, config);
}

describe("RateLimitGuard client IP", () => {
  it("ignores a rotating X-Forwarded-For header and limits by request.ip", () => {
    const g = guard("spec.xff");
    expect(g.canActivate(context({ "x-forwarded-for": "1.1.1.1" }, "10.0.0.9"))).toBe(true);
    expect(g.canActivate(context({ "x-forwarded-for": "2.2.2.2" }, "10.0.0.9"))).toBe(true);
    expect(() => g.canActivate(context({ "x-forwarded-for": "3.3.3.3" }, "10.0.0.9"))).toThrow();
  });
});
