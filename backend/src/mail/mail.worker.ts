import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { setTimeout as sleep } from "node:timers/promises";
import { AppModule } from "../app.module";
import { MailService } from "./mail.service";

const logger = new Logger("MailWorker");
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const mail = app.get(MailService);
  const config = app.get(ConfigService);
  const once = process.argv.includes("--once");
  const abort = new AbortController();
  let stopping = false;
  const stop = () => { stopping = true; abort.abort(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const intervalMs = Number(config.get("MAIL_WORKER_INTERVAL_MS") || 30000);
  const batchSize = Number(config.get("MAIL_WORKER_BATCH_SIZE") || 25);
  try {
    while (!stopping) {
      try {
        const result = await mail.processQueuedEmails({ limit: batchSize, shouldStop: () => stopping });
        logger.log(JSON.stringify({ event: "mail_worker_drain", ...result }));
      } catch {
        logger.error(JSON.stringify({ event: "mail_worker_error", code: "BATCH_FAILED", retryAfterMs: intervalMs }));
        if (once) { process.exitCode = 1; break; }
      }
      if (once || stopping) break;
      try { await sleep(intervalMs, undefined, { signal: abort.signal }); }
      catch { if (!stopping) throw new Error("Worker timer interrupted"); }
    }
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    await app.close();
  }
}
bootstrap().catch(() => { logger.error("MAIL_WORKER_STARTUP_FAILED: check validated server configuration."); process.exitCode = 1; });
