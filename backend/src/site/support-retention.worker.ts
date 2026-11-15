import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { SupportService } from "./support.service";

// Intended for a deployment scheduler. One invocation is bounded to 20 batches.
// Expiration already denies API access; this task physically removes retained PII.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const logger = new Logger("SupportRetention");
  try {
    const support = app.get(SupportService);
    let deleted = 0;
    let moreMayRemain = false;
    for (let batch = 0; batch < 20; batch += 1) {
      const result = await support.purgeExpired();
      deleted += result.deleted;
      moreMayRemain = result.deleted === 500;
      if (!moreMayRemain) break;
    }
    console.log(JSON.stringify({ event: "support_retention", deleted, moreMayRemain }));
    if (moreMayRemain) logger.warn("More expired tickets may remain. Run the next scheduled batch.");
  } finally { await app.close(); }
}
bootstrap().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Support retention failed"); process.exitCode = 1; });
