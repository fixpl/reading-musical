import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import type { RequestUser } from "../types/request-user";

type JwtPayload = {
  sub: string;
  email: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException("다시 로그인해 주세요");
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>("JWT_ACCESS_SECRET")
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, name: true, platformRole: true, status: true }
      });

      if (!user || user.status !== "ACTIVE") {
        throw new UnauthorizedException("다시 로그인해 주세요");
      }

      request.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole
      };
      return true;
    } catch {
      throw new UnauthorizedException("다시 로그인해 주세요");
    }
  }

  private extractBearerToken(request: Request): string | null {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" && token ? token : null;
  }
}
