// Prisma 7 configuration. Replaces the (now removed) datasource `url` field
// in schema.prisma — see https://pris.ly/d/config-datasource.
//
// Named `prisma7.config.ts` because that is the filename the Prisma 7 CLI
// looks for first (falling back to the legacy `prisma.config.ts`).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
