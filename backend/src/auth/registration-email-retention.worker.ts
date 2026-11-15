import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { RegistrationEmailRetentionService } from "./registration-email-retention.service";

// scheduler용 유한 작업이다. 메일 발송 중단과 관계없이 만료된 인증 자료를 파기한다.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  try {
    const retention = app.get(RegistrationEmailRetentionService);
    let deleted = 0;
    let sanitized = 0;
    let deletedDeliveries = 0;
    let anonymized = 0;
    let moreMayRemain = false;
    for (let batch = 0; batch < 20; batch += 1) {
      const result = await retention.purgeExpiredBatch();
      deleted += result.deleted;
      sanitized += result.sanitized;
      deletedDeliveries += result.deletedDeliveries;
      anonymized += result.anonymized;
      moreMayRemain = result.moreMayRemain;
      if (!moreMayRemain) break;
    }
    console.log(JSON.stringify({ deleted, sanitized, deletedDeliveries, anonymized, moreMayRemain }));
  } finally {
    await app.close();
  }
}
bootstrap().catch(() => { console.error("REGISTRATION_EMAIL_RETENTION_FAILED: 서버 설정과 DB 연결 상태를 확인해 주세요."); process.exitCode = 1; });
