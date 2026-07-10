import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { parseAdminVisibility } from "@/lib/video-visibility";
import {
  ShortVideoAdminService,
  type ShortVideoAdminFilters,
} from "@/services/short-video-admin.service";
import type { CourseStatus } from "@prisma/client";

/** Admin: list short videos with search and visibility filters. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const filters: ShortVideoAdminFilters = {
    ...(statusParam ? { status: statusParam as CourseStatus } : {}),
    q: searchParams.get("q") ?? undefined,
    visibility: parseAdminVisibility(searchParams.get("visibility")),
    sort: (searchParams.get("sort") as ShortVideoAdminFilters["sort"]) ?? "newest",
  };

  const videos = await ShortVideoAdminService.list(filters);
  return json({ videos });
}
