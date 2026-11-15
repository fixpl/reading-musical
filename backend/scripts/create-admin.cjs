#!/usr/bin/env node
// 운영 DB에 총관리자(SUPER_ADMIN) 계정을 만든다. 시연 공연·배우 계정을 만드는 prisma seed와 달리 계정 하나만 다룬다.
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='12자 이상' node scripts/create-admin.cjs
//   이미 있는 이메일이면 총관리자 권한만 올린다(비밀번호는 --reset-password 를 붙일 때만 바꾼다).
// DATABASE_URL 은 환경변수(없으면 backend/.env)에서 읽는다. 컨테이너에는 개발 도구(tsx)가 없어도 실행된다.
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const envFile = path.resolve(__dirname, "..", ".env");
const env = { ...(fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {}), ...process.env };
const email = (env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = env.ADMIN_PASSWORD || "";
const resetPassword = process.argv.includes("--reset-password");

if (!env.DATABASE_URL) { console.error("DATABASE_URL 설정이 필요합니다."); process.exit(2); }
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("ADMIN_EMAIL 에 올바른 이메일을 넣어 주세요."); process.exit(2); }

(async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const data = { platformRole: "SUPER_ADMIN", status: "ACTIVE" };
      if (resetPassword) {
        if (password.length < 12) { console.error("ADMIN_PASSWORD 는 12자 이상이어야 합니다."); process.exit(2); }
        data.passwordHash = await bcrypt.hash(password, 12);
        data.failedLoginCount = 0; data.lockedUntil = null;
      }
      await prisma.user.update({ where: { id: existing.id }, data });
      console.log(`기존 계정을 총관리자로 올렸습니다: ${email}${resetPassword ? " (비밀번호 변경)" : ""}`);
      return;
    }
    if (password.length < 12) { console.error("새 계정을 만들려면 ADMIN_PASSWORD(12자 이상)가 필요합니다."); process.exit(2); }
    const organization = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ?? (await prisma.organization.create({ data: { name: "아트브릿지 운영단체" } }));
    await prisma.user.create({
      data: {
        organizationId: organization.id, email, passwordHash: await bcrypt.hash(password, 12),
        name: env.ADMIN_NAME?.trim() || "운영 관리자", profileType: "PLANNER", profileDetails: { position: "최종관리자" },
        profileComplete: true, status: "ACTIVE", platformRole: "SUPER_ADMIN"
      }
    });
    console.log(`총관리자를 만들었습니다: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
