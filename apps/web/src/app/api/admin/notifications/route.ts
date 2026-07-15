import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { NotificationService } from "@/services/notification.service";

export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      country: { select: { nameEn: true } },
      _count: { select: { deliveries: true } },
    },
  });

  return json({ notifications });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const {
    titleEn, titleAr, titleKu, titleTr,
    bodyEn, bodyAr, bodyKu, bodyTr,
    channels, countryId, provinceId, userIds,
  } = body;

  // UI historically sent "ALL"; Prisma enum is EVERYONE.
  const rawTarget = String(body.target ?? "");
  const target =
    rawTarget === "ALL" || rawTarget === "EVERYONE"
      ? "EVERYONE"
      : rawTarget === "COUNTRY" || rawTarget === "PROVINCE" || rawTarget === "USERS"
        ? rawTarget
        : null;

  if (!titleEn || !bodyEn || !channels?.length || !target) {
    return error("Missing required fields", 422, "VALIDATION");
  }

  const notification = await NotificationService.broadcast({
    message: {
      titleEn,
      titleAr: titleAr || titleEn,
      titleKu: titleKu || titleEn,
      titleTr: titleTr || titleEn,
      bodyEn,
      bodyAr: bodyAr || bodyEn,
      bodyKu: bodyKu || bodyEn,
      bodyTr: bodyTr || bodyEn,
    },
    channels,
    target,
    countryId,
    provinceId,
    userIds,
    createdById: auth.session.userId,
    data: body.data && typeof body.data === "object"
      ? body.data
      : {
          type: body.linkType || "admin",
          screen: body.screen || "ads",
          adId: body.adId,
          courseId: body.courseId,
        },
  });

  return json({ notification }, 201);
}
