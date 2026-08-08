import path from "node:path";
import { PrismaClient } from "@/lib/generated/prisma/client";

// Next.js dev mode hot-reloads modules on every edit, which would otherwise
// open a new database connection pool each time until SQLite refuses more.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * A relative `file:./dev.db` URL resolves against the *importing bundle's*
 * directory, not the project root. Server actions happen to bundle near the
 * root so they find `prisma/dev.db`, but a route handler bundles into
 * `.next/server/app/api/<route>/` and silently creates an empty database
 * there instead — queries then fail with "table does not exist" against a
 * file nobody migrated. Anchoring to cwd keeps every entry point on one
 * database.
 */
function resolvedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) return url;

  const filePath = url.slice("file:".length);
  if (path.isAbsolute(filePath)) return url;

  return `file:${path.resolve(process.cwd(), "prisma", filePath)}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolvedDatabaseUrl() } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
