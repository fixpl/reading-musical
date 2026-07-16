import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { ScheduleService } from "./schedule.service";

const logger = new Logger("AttendanceReminderWorker");

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"]
  });
  const schedule = app.get(ScheduleService);
  const lookaheadHours = numberEnv("ATTENDANCE_REMINDER_LOOKAHEAD_HOURS", 24);

  try {
    const result = await schedule.sendAttendanceReminders({ lookaheadHours });
    logger.log(JSON.stringify({ event: "attendance_reminder_drain", ...result }));
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
