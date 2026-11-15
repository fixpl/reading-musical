#!/usr/bin/env node
// 서버 디스크(.asset-objects)에 있는 기존 업로드 파일을 Cloudflare R2로 옮기고 DB의 storageKey를 새 키로 바꾼다.
//   node scripts/migrate-assets-to-r2.cjs            # 미리보기(변경 없음)
//   node scripts/migrate-assets-to-r2.cjs --apply    # 실제 업로드 + DB 갱신(로컬 파일은 지우지 않는다)
// backend/.env 의 DATABASE_URL, R2_* 설정을 읽는다. 이미 R2 키인 자료와 로컬 파일이 없는 자료는 건너뛴다.
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const root = path.resolve(__dirname, "..");
const env = { ...parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8")), ...process.env };
const apply = process.argv.includes("--apply");
for (const key of ["DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
  if (!env[key]) { console.error(`${key} 설정이 필요합니다.`); process.exit(2); }
}
const clean = (value) => String(value || "").replace(/^\/+|\/+$/g, "");
const rootKey = `${env.R2_KEY_PREFIX ? `${clean(env.R2_KEY_PREFIX)}/` : ""}${clean(env.R2_PROJECT_NAME || "reading-musical")}/`;
const objectDir = path.resolve(root, env.ASSET_OBJECT_DIR || ".asset-objects");
const s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, forcePathStyle: true,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

(async () => {
  const assets = await prisma.asset.findMany({ where: { NOT: { storageKey: { startsWith: rootKey } } }, orderBy: { createdAt: "asc" } });
  let moved = 0, missing = 0, failed = 0;
  console.log(`${apply ? "[적용]" : "[미리보기]"} 옮길 후보 ${assets.length}개 → 버킷 ${env.R2_BUCKET}, 키 ${rootKey}{폴더}/{연도}/…`);
  for (const asset of assets) {
    const local = path.join(objectDir, `${asset.id}.bin`);
    if (!fs.existsSync(local)) { missing += 1; continue; }
    const folder = asset.storageKey.split("/")[0] || "misc";
    const tail = asset.storageKey.split("/").pop();
    const key = `${rootKey}${folder}/${new Date(asset.createdAt).getUTCFullYear()}/${tail}`;
    const size = fs.statSync(local).size;
    console.log(`${apply ? "↑" : "·"} ${asset.id}  ${(size / 1048576).toFixed(1)}MB  ${asset.storageKey} → ${key}`);
    if (!apply) continue;
    try {
      await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: fs.createReadStream(local), ContentLength: size, ContentType: asset.mime }));
      const head = await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      if (Number(head.ContentLength) !== size) throw new Error(`크기 불일치 ${head.ContentLength} != ${size}`);
      await prisma.asset.update({ where: { id: asset.id }, data: { storageKey: key } });
      moved += 1;
    } catch (error) { failed += 1; console.error(`  실패: ${error.message}`); }
  }
  console.log(`끝: 옮김 ${moved}, 로컬 파일 없음 ${missing}, 실패 ${failed}${apply ? "" : " (미리보기라 변경 없음)"}`);
  await prisma.$disconnect();
})().catch((error) => { console.error(error); process.exit(1); });
