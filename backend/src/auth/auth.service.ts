import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PlatformRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Response } from "express";
import type { StringValue } from "ms";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from "./dto";

type PasswordResetPayload = {
  sub: string;
  email: string;
  purpose: "password-reset";
  fp: string;
};

type RefreshTokenPayload = {
  sub: string;
  email: string;
  purpose: "refresh";
  sid: string;
  rid: string;
};

type SignedTokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.agreements?.terms || !dto.agreements?.privacy) {
      throw new BadRequestException("필수 약관에 동의해 주세요");
    }

    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new ConflictException("이미 가입된 이메일이에요");
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        name: dto.name,
        phone: dto.phone,
        profileType: dto.profileType,
        profileComplete: Boolean(dto.phone),
        platformRole: PlatformRole.MEMBER
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        platformRole: true,
        profileType: true
      }
    });

    return {
      user,
      tokens: await this.issueTokens(user.id, user.email),
      next: "/app"
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("이메일 또는 비밀번호를 확인해 주세요");
    }

    const now = new Date();
    const lockExpired = Boolean(user.lockedUntil && user.lockedUntil <= now);
    if (user.lockedUntil && user.lockedUntil > now) {
      throw this.loginLockedException(user.lockedUntil);
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      await this.recordFailedLogin(user.id, lockExpired ? 0 : user.failedLoginCount);
      throw new UnauthorizedException("이메일 또는 비밀번호를 확인해 주세요");
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null }
      });
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        platformRole: user.platformRole,
        profileType: user.profileType
      },
      tokens: await this.issueTokens(user.id, user.email),
      next: user.platformRole === PlatformRole.SUPER_ADMIN ? "/admin" : "/productions"
    };
  }

  async refresh(dto: RefreshDto) {
    if (!dto.refreshToken) {
      throw new UnauthorizedException("다시 로그인해 주세요");
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(dto.refreshToken, {
        secret: this.config.get<string>("JWT_REFRESH_SECRET")
      });
    } catch {
      throw new UnauthorizedException("다시 로그인해 주세요");
    }

    if (payload.purpose !== "refresh" || !payload.sid) {
      throw new UnauthorizedException("다시 로그인해 주세요");
    }

    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, status: true }
      }),
      this.prisma.authSession.findUnique({
        where: { id: payload.sid },
        select: { id: true, userId: true, tokenHash: true, expiresAt: true, revokedAt: true }
      })
    ]);

    const now = new Date();
    const presentedHash = this.refreshTokenHash(dto.refreshToken);
    if (!user || user.email !== payload.email || user.status !== "ACTIVE") {
      await this.revokeAuthSession(payload.sid, "USER_INACTIVE");
      throw new UnauthorizedException("다시 로그인해 주세요");
    }
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException("다시 로그인해 주세요");
    }
    if (session.tokenHash !== presentedHash) {
      await this.revokeAuthSession(payload.sid, "REUSE_DETECTED");
      throw new UnauthorizedException("다시 로그인해 주세요");
    }

    return { tokens: await this.rotateTokens(session.id, user.id, user.email, presentedHash) };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.status !== "ACTIVE") {
      return {
        ok: true,
        message: "가입된 이메일이면 비밀번호 재설정 링크를 보냈어요."
      };
    }

    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        purpose: "password-reset",
        fp: this.passwordFingerprint(user.passwordHash)
      } satisfies PasswordResetPayload,
      {
        secret: this.passwordResetSecret(),
        expiresIn: "30m"
      }
    );
    const resetUrl = `${this.appPublicUrl()}/reset?token=${encodeURIComponent(token)}`;
    const emailDelivery = await this.mail.queueEmail({
      userId: user.id,
      toEmail: user.email,
      subject: "[아트브릿지] 비밀번호 재설정 안내",
      templateKey: "auth.password_reset",
      bypassUserPreference: true,
      bodyText: [
        `${user.name}님,`,
        "",
        "비밀번호 재설정 요청이 접수되었습니다.",
        "아래 링크는 30분 동안만 사용할 수 있습니다.",
        "",
        resetUrl,
        "",
        "본인이 요청하지 않았다면 이 메일을 무시해 주세요."
      ].join("\n"),
      metadata: {
        expiresInMinutes: 30,
        fromEmail: this.mail.fromEmail()
      }
    });

    return {
      ok: true,
      message: "가입된 이메일이면 비밀번호 재설정 링크를 보냈어요.",
      expiresInMinutes: 30,
      emailDeliveryId: this.exposeDevResetUrl() ? emailDelivery.id : undefined,
      devResetUrl: this.exposeDevResetUrl() ? resetUrl : undefined
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    let payload: PasswordResetPayload;
    try {
      payload = await this.jwtService.verifyAsync<PasswordResetPayload>(dto.token, {
        secret: this.passwordResetSecret()
      });
    } catch {
      throw new BadRequestException("링크가 만료됐어요. 다시 요청해 주세요.");
    }

    if (payload.purpose !== "password-reset") {
      throw new BadRequestException("링크가 만료됐어요. 다시 요청해 주세요.");
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.email !== payload.email || user.status !== "ACTIVE") {
      throw new BadRequestException("링크가 만료됐어요. 다시 요청해 주세요.");
    }
    if (this.passwordFingerprint(user.passwordHash) !== payload.fp) {
      throw new BadRequestException("이미 사용된 링크예요. 다시 요청해 주세요.");
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(dto.newPassword, 12),
          failedLoginCount: 0,
          lockedUntil: null
        }
      }),
      this.prisma.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "PASSWORD_RESET" }
      })
    ]);

    return { ok: true, next: "/login" };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
        organization: { select: { id: true, name: true, status: true } },
        email: true,
        name: true,
        phone: true,
        gender: true,
        birthDate: true,
        address: true,
        status: true,
        platformRole: true,
        profileType: true,
        profileDetails: true,
        photoAssetId: true,
        emailNotify: true,
        profileComplete: true,
        memberships: {
          select: {
            id: true,
            productionId: true,
            primaryRole: true,
            roles: { select: { role: true } }
          }
        }
      }
    });

    const settings = this.objectRecord(this.objectRecord(user.profileDetails).settings);
    return {
      ...user,
      settings: {
        emailNotify: user.emailNotify,
        locale: settings.locale ?? "ko",
        theme: settings.theme ?? "system"
      },
      memberships: user.memberships.map((membership) => ({
        ...membership,
        roles: membership.roles.map((role) => role.role)
      }))
    };
  }

  async logout(userId: string, refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>("JWT_REFRESH_SECRET")
      });
      if (payload.purpose === "refresh" && payload.sub === userId && payload.sid) {
        await this.revokeAuthSession(payload.sid, "LOGOUT");
      }
    } catch {
      // Logout must be idempotent. The cookie is cleared even when the token is already invalid.
    }
  }

  private async issueTokens(userId: string, email: string) {
    const sessionId = randomUUID();
    const signed = await this.signTokensForSession(userId, email, sessionId);
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: this.refreshTokenHash(signed.refreshToken),
        expiresAt: signed.refreshExpiresAt
      }
    });
    return this.publicTokens(signed);
  }

  private async rotateTokens(sessionId: string, userId: string, email: string, currentTokenHash: string) {
    const signed = await this.signTokensForSession(userId, email, sessionId);
    const updated = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        userId,
        tokenHash: currentTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: {
        tokenHash: this.refreshTokenHash(signed.refreshToken),
        expiresAt: signed.refreshExpiresAt,
        lastRotatedAt: new Date()
      }
    });
    if (updated.count !== 1) {
      await this.revokeAuthSession(sessionId, "ROTATION_CONFLICT");
      throw new UnauthorizedException("다시 로그인해 주세요");
    }
    return this.publicTokens(signed);
  }

  private async signTokensForSession(userId: string, email: string, sessionId: string): Promise<SignedTokenPair> {
    const accessToken = await this.jwtService.signAsync({ sub: userId, email }, {
      secret: this.config.get<string>("JWT_ACCESS_SECRET"),
      expiresIn: this.accessTokenExpiresIn()
    });
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, email, purpose: "refresh", sid: sessionId, rid: randomUUID() } satisfies RefreshTokenPayload,
      {
        secret: this.config.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: this.refreshTokenExpiresIn()
      }
    );
    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: new Date(Date.now() + this.durationToMs(this.refreshTokenExpiresIn()))
    };
  }

  private publicTokens(tokens: SignedTokenPair) {
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  private async revokeAuthSession(sessionId: string, reason: string) {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason }
    });
  }

  private refreshTokenHash(refreshToken: string) {
    return createHash("sha256").update(refreshToken).digest("hex");
  }

  attachRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(this.refreshCookieName(), refreshToken, this.refreshCookieOptions());
    response.cookie(this.csrfCookieName(), this.csrfTokenFor(refreshToken), this.csrfCookieOptions());
  }

  clearRefreshCookie(response: Response) {
    response.clearCookie(this.refreshCookieName(), this.refreshCookieClearOptions());
    response.clearCookie(this.csrfCookieName(), this.csrfCookieClearOptions());
  }

  // 재설정 링크 노출은 명시적 로컬 개발 플래그로만 — NODE_ENV 미설정 배포에서 토큰이 새는 사고 방지.
  private exposeDevResetUrl() {
    return this.config.get<string>("AUTH_EXPOSE_DEV_RESET_URL") === "true";
  }

  readRefreshCookie(cookieHeader: string | undefined) {
    return this.readCookie(cookieHeader, this.refreshCookieName());
  }

  assertCookieRefreshCsrf(cookieHeader: string | undefined, csrfHeader: string | string[] | undefined, refreshToken: string) {
    const headerToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    const cookieToken = this.readCookie(cookieHeader, this.csrfCookieName());
    const expectedToken = this.csrfTokenFor(refreshToken);
    if (!headerToken || !cookieToken || !this.safeEqual(headerToken, cookieToken) || !this.safeEqual(headerToken, expectedToken)) {
      throw new ForbiddenException({
        code: "CSRF_INVALID",
        message: "요청 보안 토큰이 유효하지 않아요"
      });
    }
  }

  private async recordFailedLogin(userId: string, currentFailedLoginCount: number) {
    const nextFailedLoginCount = currentFailedLoginCount + 1;
    const maxAttempts = this.maxFailedLoginAttempts();
    const lockedUntil =
      nextFailedLoginCount >= maxAttempts ? new Date(Date.now() + this.loginLockMinutes() * 60 * 1000) : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextFailedLoginCount,
        lockedUntil
      }
    });

    if (lockedUntil) {
      throw this.loginLockedException(lockedUntil);
    }
  }

  private loginLockedException(lockedUntil: Date) {
    return new HttpException(
      {
        message: "로그인 시도가 잠시 제한됐어요. 잠시 후 다시 시도하거나 비밀번호를 재설정해 주세요.",
        code: "AUTH_LOGIN_LOCKED",
        lockedUntil: lockedUntil.toISOString()
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private maxFailedLoginAttempts() {
    const value = Number(this.config.get<string>("AUTH_MAX_FAILED_LOGIN_ATTEMPTS") || 5);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5;
  }

  private loginLockMinutes() {
    const value = Number(this.config.get<string>("AUTH_LOGIN_LOCK_MINUTES") || 15);
    return Number.isFinite(value) && value > 0 ? value : 15;
  }

  private accessTokenExpiresIn(): StringValue {
    return this.durationConfig("JWT_ACCESS_EXPIRES_IN", "15m");
  }

  private refreshTokenExpiresIn(): StringValue {
    return this.durationConfig("JWT_REFRESH_EXPIRES_IN", "7d");
  }

  private refreshCookieName() {
    return this.config.get<string>("AUTH_REFRESH_COOKIE_NAME") || "reading_musical_refresh";
  }

  private csrfCookieName() {
    return "reading_musical_csrf";
  }

  private refreshCookieOptions(): CookieOptions {
    const options: CookieOptions = {
      httpOnly: true,
      secure: this.refreshCookieSecure(),
      sameSite: this.refreshCookieSameSite(),
      path: this.refreshCookiePath(),
      maxAge: this.durationToMs(this.refreshTokenExpiresIn())
    };
    const domain = this.cookieDomain();
    if (domain) {
      options.domain = domain;
    }
    return options;
  }

  private csrfCookieOptions(): CookieOptions {
    const options: CookieOptions = {
      httpOnly: false,
      secure: this.refreshCookieSecure(),
      sameSite: this.refreshCookieSameSite(),
      path: this.refreshCookiePath(),
      maxAge: this.durationToMs(this.refreshTokenExpiresIn())
    };
    const domain = this.cookieDomain();
    if (domain) {
      options.domain = domain;
    }
    return options;
  }

  private refreshCookieClearOptions(): CookieOptions {
    const options: CookieOptions = {
      httpOnly: true,
      secure: this.refreshCookieSecure(),
      sameSite: this.refreshCookieSameSite(),
      path: this.refreshCookiePath()
    };
    const domain = this.cookieDomain();
    if (domain) {
      options.domain = domain;
    }
    return options;
  }

  private csrfCookieClearOptions(): CookieOptions {
    const options: CookieOptions = {
      httpOnly: false,
      secure: this.refreshCookieSecure(),
      sameSite: this.refreshCookieSameSite(),
      path: this.refreshCookiePath()
    };
    const domain = this.cookieDomain();
    if (domain) {
      options.domain = domain;
    }
    return options;
  }

  private refreshCookiePath() {
    const apiPrefix = (this.config.get<string>("API_PREFIX") || "/api/v1").replace(/^\/?/, "/").replace(/\/+$/, "");
    return `${apiPrefix}/auth/refresh`;
  }

  private refreshCookieSecure() {
    const configured = this.config.get<string>("AUTH_REFRESH_COOKIE_SECURE");
    if (configured !== undefined) {
      return configured === "true";
    }
    return this.config.get<string>("NODE_ENV") === "production";
  }

  private refreshCookieSameSite(): CookieOptions["sameSite"] {
    const configured = (this.config.get<string>("AUTH_REFRESH_COOKIE_SAMESITE") || "lax").toLowerCase();
    return configured === "none" || configured === "strict" || configured === "lax" ? configured : "lax";
  }

  private cookieDomain() {
    const domain = this.config.get<string>("COOKIE_DOMAIN")?.trim();
    if (!domain || domain === "localhost" || domain === "127.0.0.1") {
      return undefined;
    }
    return domain;
  }

  private readCookie(cookieHeader: string | undefined, name: string) {
    if (!cookieHeader) {
      return undefined;
    }
    const cookieName = `${name}=`;
    const cookie = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookieName));
    return cookie ? decodeURIComponent(cookie.slice(cookieName.length)) : undefined;
  }

  private csrfTokenFor(refreshToken: string) {
    return createHmac("sha256", this.config.get<string>("JWT_REFRESH_SECRET") || "")
      .update(refreshToken)
      .digest("hex");
  }

  private safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private durationToMs(value: string) {
    const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim());
    if (!match) {
      return 7 * 24 * 60 * 60 * 1000;
    }
    const amount = Number(match[1]);
    const unit = match[2] || "ms";
    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };
    return amount * multipliers[unit];
  }

  private durationConfig(key: string, fallback: StringValue): StringValue {
    const value = this.config.get<string>(key) || fallback;
    return /^\d+(ms|s|m|h|d)$/.test(value) ? (value as StringValue) : fallback;
  }

  private passwordResetSecret() {
    return this.config.get<string>("JWT_PASSWORD_RESET_SECRET") || `${this.config.get<string>("JWT_REFRESH_SECRET")}:password-reset`;
  }

  private appPublicUrl() {
    return (this.config.get<string>("APP_PUBLIC_URL") || "http://localhost:5173").replace(/\/+$/, "");
  }

  private passwordFingerprint(passwordHash: string) {
    return createHash("sha256").update(passwordHash).digest("hex").slice(0, 24);
  }

  private objectRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
}
