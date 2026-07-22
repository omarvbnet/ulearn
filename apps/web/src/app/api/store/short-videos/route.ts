import { json, optionalAuth } from "@/lib/api";
import { ShortVideoService } from "@/services/short-video.service";

/** Public feed of approved teacher short videos (reels). */
export async function GET(request: Request) {
  const session = await optionalAuth();

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "12");
  const refresh = searchParams.get("refresh") === "true";

  const feed = await ShortVideoService.listFeed({
    userId: session?.userId,
    cursor: refresh ? undefined : cursor,
    limit: Number.isFinite(limit) ? limit : 12,
    refresh,
  });

  return json(feed);
}
