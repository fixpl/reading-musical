import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map } from "rxjs";

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

// 사용자 요약({ id, email, name, profileType, … }) 모양의 객체에서 이메일을 가린다.
// 공동 작업 응답의 중첩 연락처를 가리고, 권한별 연락처는 멤버 화면에서만 제공한다.
export function maskUserEmails<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => maskUserEmails(item)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, maskUserEmails(inner)] as const);
    const copy = Object.fromEntries(entries) as Record<string, unknown>;
    if (typeof copy.email === "string" && "profileType" in copy) copy.email = maskEmail(copy.email);
    return copy as T;
  }
  return value;
}

@Injectable()
export class MaskEmailsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((body) => maskUserEmails(body)));
  }
}
