import { isAccelerateEnabled } from "@/lib/prisma";

/**
 * Prisma Accelerate cache strategies for hot read paths.
 *
 * Requires DATABASE_URL (or PRISMA_ACCELERATE_URL) to be an Accelerate URL
 * (`prisma://` or `prisma+postgres://`) and the client extended with
 * `withAccelerate()`. When the app uses a plain `postgres://` / pooled URL,
 * `withCache()` is a no-op so queries hit Postgres directly.
 *
 * ttl  = serve from cache without hitting the DB
 * swr  = after ttl, keep serving stale while refreshing in background
 * tags = optional invalidation keys (paid Accelerate plans for invalidate API)
 */
export const CacheTTL = {
  /** Rarely changing reference data: countries, provinces, stages. */
  reference: { ttl: 300, swr: 600 },
  /** Home ads / course groups / published course catalog. */
  catalog: { ttl: 60, swr: 120 },
  /** System settings, AI config, feature flags. */
  settings: { ttl: 120, swr: 300 },
  /** Short-lived user-facing lists (packages, public profiles). */
  short: { ttl: 30, swr: 60 },
} as const;

export type CacheStrategy = {
  ttl: number;
  swr: number;
  tags?: string[];
};

/**
 * Attach an Accelerate `cacheStrategy` at runtime while keeping Prisma's
 * normal `select`/`include` argument types (needed because we cast the
 * extended client back to `PrismaClient` for correct result typing).
 *
 * No-op when Accelerate is not enabled — avoids UnknownJsonError on
 * pooled/direct Postgres URLs.
 */
export function withCache<T extends object>(
  args: T,
  strategy: CacheStrategy
): T {
  if (!isAccelerateEnabled()) return args;
  return Object.assign({}, args, { cacheStrategy: strategy });
}
