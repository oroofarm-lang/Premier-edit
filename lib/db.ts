import { PrismaClient } from "@/lib/generated/prisma/client";

// Next.js dev mode hot-reloads modules on every edit, which would otherwise
// open a new database connection pool each time until SQLite refuses more.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
