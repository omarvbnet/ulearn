import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { AdminPendingCountsService } from "@/services/admin-pending-counts.service";

let cached: { at: number; counts: Awaited<ReturnType<typeof AdminPendingCountsService.getCounts>> } | null =
  null;

const CACHE_MS = 30_000;

/** Admin: pending request counts for navigation badges. */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return json({ counts: cached.counts, cached: true });
  }

  const counts = await AdminPendingCountsService.getCounts();
  cached = { at: now, counts };

  return json({ counts });
}
