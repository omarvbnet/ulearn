import { json, requireAuth } from "@/lib/api";
import { ShortVideoService } from "@/services/short-video.service";

/** Public feed of approved teacher short videos (reels). */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "10");

  const feed = await ShortVideoService.listFeed({
    userId: auth.session.userId,
    cursor,
    limit: Number.isFinite(limit) ? limit : 10,
  });

  return json(feed);
}
