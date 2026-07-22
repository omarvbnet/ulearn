import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Toggle a like on an advertisement. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const ad = await prisma.advertisement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!ad) return error("Advertisement not found", 404, "NOT_FOUND");

  const userId = auth.session.userId;
  const existing = await prisma.adLike.findUnique({
    where: { adId_userId: { adId: id, userId } },
  });

  if (existing) {
    await prisma.adLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.adLike.create({ data: { adId: id, userId } });
  }

  const likes = await prisma.adLike.count({ where: { adId: id } });
  return json({ likes, likedByMe: !existing });
}
