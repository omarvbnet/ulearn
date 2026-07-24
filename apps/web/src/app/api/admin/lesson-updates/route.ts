import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import { WHITEBOARD_PLAYBACK_EXPIRES_SEC } from "@/lib/r2-whiteboard";
import { normalizeEditDiff } from "@/lib/whiteboard/edit-diff";

/** Admin: list pending lesson update requests on live courses. */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED";

  const requests = await prisma.courseLessonUpdateRequest.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          fileUrl: true,
          thumbnailUrl: true,
          durationSec: true,
          lessonType: true,
          whiteboardAssetId: true,
          course: {
            select: {
              id: true,
              titleEn: true,
              teacher: {
                select: {
                  user: { select: { fullLegalName: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const assetIds = [
    ...new Set(
      requests
        .flatMap((r) => [r.whiteboardAssetId, r.previousWhiteboardAssetId])
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const assets = assetIds.length
    ? await prisma.whiteboardAsset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, objectKey: true, durationSec: true, theme: true },
      })
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const expiresIn = WHITEBOARD_PLAYBACK_EXPIRES_SEC;
  const signed = new Map<string, string>();
  await Promise.all(
    assets.map(async (a) => {
      try {
        signed.set(a.id, await getDownloadUrl(a.objectKey, expiresIn));
      } catch {
        /* leave missing */
      }
    })
  );

  return json({
    requests: requests.map((r) => {
      const editDiff = normalizeEditDiff(r.editDiffJson);
      const prevWb = r.previousWhiteboardAssetId
        ? assetById.get(r.previousWhiteboardAssetId)
        : null;
      const newWb = r.whiteboardAssetId ? assetById.get(r.whiteboardAssetId) : null;
      const isWhiteboard = Boolean(r.whiteboardAssetId || r.previousWhiteboardAssetId);
      return {
        ...r,
        editDiff,
        isWhiteboard,
        // Prefer snapshotted previous media (survives after approve).
        currentTitle: r.previousTitle ?? r.lesson.title,
        currentFileUrl: r.previousFileUrl ?? r.lesson.fileUrl,
        currentThumbnailUrl: r.previousThumbnailUrl ?? r.lesson.thumbnailUrl,
        currentDurationSec: r.previousDurationSec ?? r.lesson.durationSec,
        newTitle: r.title ?? r.lesson.title,
        newFileUrl: r.fileUrl,
        newThumbnailUrl: r.thumbnailUrl,
        newDurationSec: r.durationSec,
        previousWhiteboardPackageUrl: r.previousWhiteboardAssetId
          ? signed.get(r.previousWhiteboardAssetId) ?? null
          : null,
        newWhiteboardPackageUrl: r.whiteboardAssetId
          ? signed.get(r.whiteboardAssetId) ?? null
          : null,
        previousWhiteboardDurationSec: prevWb?.durationSec ?? r.previousDurationSec,
        newWhiteboardDurationSec: newWb?.durationSec ?? r.durationSec,
        changeTags: (r.changeSummary ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }),
  });
}
