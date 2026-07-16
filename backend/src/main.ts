import { HttpStatus, type INestApplicationContext, RequestMethod, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { ServerOptions } from "socket.io";
import { AppModule } from "./app.module";

function normalizePrefix(prefix: string | undefined): string {
  return (prefix || "/api/v1").replace(/^\/+|\/+$/g, "");
}

function buildApiServerUrl(externalUrl: string | undefined, apiPrefix: string): string {
  const baseUrl = (externalUrl || "http://localhost:3000").replace(/\/+$/, "");
  const prefix = `/${apiPrefix}`;
  return baseUrl.endsWith(prefix) ? baseUrl : `${baseUrl}${prefix}`;
}

function parseOrigins(value: string | undefined): string[] {
  return (value || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

class ConfiguredSocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[]
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origins,
        credentials: true
      }
    });
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 대본 붙여넣기·초안 적용은 본문이 커질 수 있다(기본 100kb 초과) — 한도를 올린다.
  app.useBodyParser("json", { limit: "4mb" });
  const config = app.get(ConfigService);
  const apiPrefix = normalizePrefix(config.get<string>("API_PREFIX"));
  const port = Number(config.get<string>("PORT") || 3000);
  const apiServerUrl = buildApiServerUrl(config.get<string>("API_EXTERNAL_URL"), apiPrefix);
  const corsOrigins = parseOrigins(config.get<string>("CORS_ORIGINS"));

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET }
    ]
  });
  app.enableCors({
    origin: corsOrigins,
    credentials: true
  });
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app, corsOrigins));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      validationError: {
        target: false,
        value: false
      }
    })
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Reading Musical API")
    .setDescription("아트브릿지 공연 기획·연출 관리 시스템 API")
    .setVersion("1.0")
    .addServer(apiServerUrl, "Configured API host")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api-json",
    customSiteTitle: "Reading Musical API Docs"
  });

  await app.listen(port);
}

bootstrap();
