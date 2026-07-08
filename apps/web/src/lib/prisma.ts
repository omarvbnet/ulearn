import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/** Prisma Postgres pooled URLs often allow ~5 connections total — cap each serverless instance at 1. */
function serverlessDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("connection_limit=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=1&pool_timeout=20`;
}

function createPrismaClient() {
  const url = serverlessDatabaseUrl();
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(url && url !== process.env.DATABASE_URL
      ? { datasources: { db: { url } } }
      : {}),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Required in production (Vercel/serverless) — without this every invocation opens a new pool.
globalForPrisma.prisma = prisma;

export default prisma;
