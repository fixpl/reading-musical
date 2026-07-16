#!/usr/bin/env node
/**
 * snake_case 전환 마이그레이션 SQL 생성기.
 *
 * 라이브 DB 카탈로그를 읽어 다음을 데이터 보존 방식(RENAME)으로 생성한다.
 *   1) enum 타입 리네임
 *   2) 컬럼 리네임 (구 테이블명 기준)
 *   3) 테이블 리네임
 *   4) 제약조건(PK/FK)·인덱스 리네임 — Prisma 네이밍 규칙과 일치시켜 이후 드리프트를 방지
 *
 * 사용: DATABASE_URL=... node scripts/generate-snake-case-migration.cjs > migration.sql
 */
const { Client } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const snake = (name) => name.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();

const pluralize = (word) => {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(word)) return word + "es";
  return word + "s";
};

const tableName = (model) => {
  const parts = snake(model).split("_");
  parts[parts.length - 1] = pluralize(parts[parts.length - 1]);
  return parts.join("_");
};

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  const tables = (
    await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`
    )
  ).rows;
  const enums = (
    await client.query(
      `SELECT t.typname FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`
    )
  ).rows;
  const columns = (
    await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name NOT LIKE '\\_prisma%'`
    )
  ).rows;
  const constraints = (
    await client.query(
      `SELECT c.conname, c.contype::text AS contype, rel.relname AS tbl
       FROM pg_constraint c
       JOIN pg_class rel ON rel.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE n.nspname = 'public' AND rel.relname NOT LIKE '\\_prisma%'`
    )
  ).rows;
  const indexes = (
    await client.query(
      `SELECT indexname, tablename FROM pg_indexes
       WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`
    )
  ).rows;

  await client.end();

  const tableMap = new Map();
  for (const { tablename } of tables) {
    if (/[A-Z]/.test(tablename)) tableMap.set(tablename, tableName(tablename));
  }

  const renameArtifact = (name, oldTable) => {
    const newTable = tableMap.get(oldTable) ?? oldTable;
    if (!name.startsWith(`${oldTable}_`)) return null;
    const rest = name.slice(oldTable.length + 1);
    const parts = rest.split("_");
    const suffix = parts.pop();
    const cols = parts.map((part) => (/[A-Z]/.test(part) ? snake(part) : part));
    const next = [newTable, ...cols, suffix].join("_");
    return next === name ? null : next;
  };

  const lines = ["-- snake_case 전환 (데이터 보존)", "", "-- 1) enum 타입"];
  for (const { typname } of enums) {
    if (/[A-Z]/.test(typname)) lines.push(`ALTER TYPE "${typname}" RENAME TO "${snake(typname)}";`);
  }

  lines.push("", "-- 2) 컬럼");
  for (const { table_name, column_name } of columns) {
    if (/[A-Z]/.test(column_name)) {
      lines.push(`ALTER TABLE "${table_name}" RENAME COLUMN "${column_name}" TO "${snake(column_name)}";`);
    }
  }

  lines.push("", "-- 3) 테이블");
  for (const [oldTable, newTable] of tableMap) {
    lines.push(`ALTER TABLE "${oldTable}" RENAME TO "${newTable}";`);
  }

  lines.push("", "-- 4) 제약조건(PK/FK)");
  const constraintNames = new Set();
  for (const { conname, tbl } of constraints) {
    constraintNames.add(conname);
    const next = renameArtifact(conname, tbl);
    if (next) {
      const newTable = tableMap.get(tbl) ?? tbl;
      lines.push(`ALTER TABLE "${newTable}" RENAME CONSTRAINT "${conname}" TO "${next}";`);
    }
  }

  lines.push("", "-- 5) 인덱스 (제약조건이 아닌 것)");
  for (const { indexname, tablename } of indexes) {
    if (constraintNames.has(indexname)) continue;
    const next = renameArtifact(indexname, tablename);
    if (next) lines.push(`ALTER INDEX "${indexname}" RENAME TO "${next}";`);
  }

  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
