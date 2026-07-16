import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOkResponse({
    description: "API process liveness check",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        service: { type: "string", example: "reading-musical-api" },
        timestamp: { type: "string", example: "2026-06-26T00:00:00.000Z" },
        uptimeSeconds: { type: "number", example: 12.3 }
      }
    }
  })
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "reading-musical-api",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(3))
    };
  }

  @ApiOkResponse({
    description: "API readiness check including database connectivity",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ready" },
        service: { type: "string", example: "reading-musical-api" },
        checks: {
          type: "object",
          properties: {
            database: { type: "string", example: "ok" }
          }
        },
        timestamp: { type: "string", example: "2026-06-26T00:00:00.000Z" },
        uptimeSeconds: { type: "number", example: 12.3 }
      }
    }
  })
  @ApiServiceUnavailableResponse({
    description: "API is alive but not ready to serve traffic"
  })
  @Get("ready")
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.buildReadinessPayload("ready", "ok");
    } catch {
      throw new ServiceUnavailableException(this.buildReadinessPayload("not_ready", "error"));
    }
  }

  private buildReadinessPayload(status: "ready" | "not_ready", database: "ok" | "error") {
    return {
      status,
      service: "reading-musical-api",
      checks: {
        database
      },
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(3))
    };
  }
}
