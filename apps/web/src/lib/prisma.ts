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

function isSupabaseUrl(url: string): boolean {
  return /supabase\.(co|com)/i.test(url) || /pooler\.supabase\.com/i.test(url);
}

/**
 * Tune DATABASE_URL for serverless + Supabase.
 *
 * - Cap connections per lambda (`connection_limit=1`).
 * - Prefer session pooler (:5432) over transaction (:6543) for Prisma when possible —
 *   `pgbouncer=true` disables prepared statements and multiplies RTTs (very slow when
 *   Vercel and Supabase are in different regions).
 * - Keep `pgbouncer=true` only when still on :6543 (required for Prisma + transaction mode).
 */
function resolveDatabaseUrl() {
  const accelerate =
    process.env.PRISMA_ACCELERATE_URL ||
    (isAccelerateUrl(process.env.DATABASE_URL)
      ? process.env.DATABASE_URL
      : undefined);
  if (accelerate) return accelerate;

  let url = process.env.DATABASE_URL;
  if (!url) return url;

  // Supabase: if someone pointed DATABASE_URL at transaction pooler, prefer session
  // when DIRECT is already session/direct on the same host (faster for Prisma).
  if (isSupabaseUrl(url) && /:6543\b/.test(url)) {
    const direct = process.env.DIRECT_DATABASE_URL || "";
    if (
      isSupabaseUrl(direct) &&
      /:5432\b/.test(direct) &&
      process.env.SUPABASE_FORCE_TRANSACTION_POOL !== "1"
    ) {
      url = direct;
      if (process.env.NODE_ENV === "production") {
        // Informational only — not an error. Prefer session pooler for Prisma latency.
        console.info(
          "[prisma] Using DIRECT_DATABASE_URL (session :5432) instead of transaction :6543 for lower latency. Set SUPABASE_FORCE_TRANSACTION_POOL=1 to keep :6543."
        );
      }
    }
  }

  const params = new URLSearchParams();
  try {
    const parsed = new URL(url.replace(/^postgres(ql)?:/i, "http:"));
    parsed.searchParams.forEach((v, k) => params.set(k, v));
  } catch {
    /* keep raw */
  }

  if (!params.has("connection_limit")) params.set("connection_limit", "1");
  if (!params.has("pool_timeout")) params.set("pool_timeout", "20");
  if (!params.has("connect_timeout")) params.set("connect_timeout", "10");

  // Transaction pooler (6543) requires this for Prisma; session (5432) is faster without it.
  if (/:6543\b/.test(url) && !params.has("pgbouncer")) {
    params.set("pgbouncer", "true");
  }
  if (!/:6543\b/.test(url)) {
    params.delete("pgbouncer");
  }

  const base = url.split("?")[0];
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
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
