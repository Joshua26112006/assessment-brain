import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 7 no longer connects via an implicit datasource URL — the client
 * requires an explicit driver adapter. PrismaPg (the standard node-postgres
 * adapter) is used rather than a Neon-specific adapter so this keeps working
 * unchanged if the database ever moves off Neon to another standard
 * PostgreSQL provider.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and configure it.",
  );
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

/**
 * Singleton PrismaClient instance for the Next.js dev server.
 *
 * Next.js hot-reloads modules in development, which would otherwise create a
 * new PrismaClient (and a new connection pool) on every edit. Caching the
 * instance on `globalThis` survives module reloads while staying scoped to a
 * single process in production.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
