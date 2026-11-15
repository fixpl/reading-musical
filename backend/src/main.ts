import { HttpStatus, type INestApplicationContext, RequestMethod, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
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
  return (value || "http://localhost:5179,http://127.0.0.1:5179")
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
  // 보안 헤더. 이 서버는 JSON·로컬 개발용 파일만 내보내므로 CSP는 끄고, 다른 출처 웹 화면이 파일을 불러올 수 있게 CORP는 cross-origin으로 둔다.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  const config = app.get(ConfigService);
  // Dokploy/Traefik 1단 뒤에서만 X-Forwarded-For를 신뢰한다 — 가드는 항상 request.ip를 쓰므로 헤더 회전으로 IP 제한을 우회할 수 없다.
  if (config.get<string>("RATE_LIMIT_TRUST_PROXY") === "true") {
    app.set("trust proxy", 1);
  }
  app.enableShutdownHooks();
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

  // API 문서는 운영에서 기본 비공개(SWAGGER_ENABLED=true 로 켤 수 있다).
  const swaggerEnabled = config.get<string>("SWAGGER_ENABLED") === "true" || config.get<string>("NODE_ENV") !== "production";
  if (swaggerEnabled) {
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
  }

  // The local launcher sets HOST=127.0.0.1; container deployments keep the default.
  await app.listen(port, config.get<string>("HOST") || "0.0.0.0");
}

bootstrap();
