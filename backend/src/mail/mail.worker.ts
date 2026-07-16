import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { setTimeout as sleep } from "node:timers/promises";
import { AppModule } from "../app.module";
import { MailService } from "./mail.service";

const logger = new Logger("MailWorker");

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"]
  });
  const mail = app.get(MailService);
  const once = process.argv.includes("--once");
  const intervalMs = numberEnv("MAIL_WORKER_INTERVAL_MS", 30000);
  const batchSize = numberEnv("MAIL_WORKER_BATCH_SIZE", 25);

  try {
    do {
      const result = await mail.processQueuedEmails({ limit: batchSize });
      logger.log(JSON.stringify({ event: "mail_worker_drain", ...result }));
      if (once) {
        break;
      }
      await sleep(intervalMs);
    } while (true);
  } finally {
    await app.close();
  }
}

function numberEnv(key: string, fallback: number) {
  const value = Number(process.env[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

bootstrap().catch((error) => {
  logger.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
