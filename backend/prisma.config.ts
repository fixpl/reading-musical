import "dotenv/config";
import { defineConfig, env } from "prisma/config";

type Env = { DATABASE_URL: string };
// Client generation/schema validation never open a database connection.
// Keep actual database commands strict; do not supply runtime credentials to offline checks.
const schemaOnly = ["generate", "validate", "format"].includes(process.argv[2] ?? "");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts"
  },
  datasource: {
    url: schemaOnly ? "postgresql://schema_only@127.0.0.1:1/schema_only" : env<Env>("DATABASE_URL")
  }
});
