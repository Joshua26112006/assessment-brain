import { PrismaClient } from "@prisma/client";

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

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
