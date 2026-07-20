/**
 * Prisma Accelerate cache strategies for hot read paths.
 * Requires DATABASE_URL to be an Accelerate / Prisma Postgres URL
 * (`prisma://` or `prisma+postgres://`) and the client extended with
 * `withAccelerate()`.
 *
 * ttl  = serve from cache without hitting the DB
 * swr  = after ttl, keep serving stale while refreshing in background
 * tags = optional invalidation keys (paid Accelerate plans)
 */
export const CacheTTL = {
  /** Rarely changing reference data: countries, provinces, stages. */
  reference: { ttl: 300, swr: 600, tags: ["reference"] as string[] },
  /** Home ads / course groups / published course catalog. */
  catalog: { ttl: 60, swr: 120, tags: ["catalog"] as string[] },
  /** System settings, AI config, feature flags. */
  settings: { ttl: 120, swr: 300, tags: ["settings"] as string[] },
  /** Short-lived user-facing lists (packages, public profiles). */
  short: { ttl: 30, swr: 60, tags: ["short"] as string[] },
} as const;

export type CacheStrategy = {
  ttl: number;
  swr: number;
  tags?: string[];
};
