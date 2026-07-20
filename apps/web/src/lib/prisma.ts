import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export function isAccelerateUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith("prisma://") ||
    url.startsWith("prisma+postgres://") ||
    url.includes("accelerate.prisma-data.net")
  );
}

/**
 * True when the runtime connection goes through Prisma Accelerate
 * (`prisma://` / `prisma+postgres://`). Pooled `postgres://…@pooled.db.prisma.io`
 * is NOT Accelerate — query cache / `--no-engine` do not apply there.
 */
export function isAccelerateEnabled(): boolean {
  return Boolean(
    isAccelerateUrl(process.env.PRISMA_ACCELERATE_URL) ||
      isAccelerateUrl(process.env.DATABASE_URL)
  );
}

/**
 * Cap pooled Postgres connections per serverless instance.
 * Skip for Accelerate / Prisma Postgres Accelerate URLs — Accelerate manages pooling.
 */
function resolveDatabaseUrl() {
  const accelerate =
    process.env.PRISMA_ACCELERATE_URL ||
    (isAccelerateUrl(process.env.DATABASE_URL)
      ? process.env.DATABASE_URL
      : undefined);
  if (accelerate) return accelerate;

  const url = process.env.DATABASE_URL;
  if (!url || url.includes("connection_limit=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=1&pool_timeout=20`;
}

function createPrismaClient(): PrismaClient {
  const url = resolveDatabaseUrl();
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(url && url !== process.env.DATABASE_URL
      ? { datasources: { db: { url } } }
      : {}),
  });

  // Only extend when talking to Accelerate. Applying withAccelerate() +
  // cacheStrategy against a plain postgres:// URL causes UnknownJsonError
  // / broken requests in production.
  if (!isAccelerateEnabled()) {
    return base;
  }

  // Cast back to PrismaClient so `select` / `include` typings stay correct
  // (`$extends(withAccelerate())` otherwise widens results to the base model).
  return base.$extends(withAccelerate()) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Required in production (Vercel/serverless) — without this every invocation opens a new pool.
globalForPrisma.prisma = prisma;

export default prisma;
