import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { NotificationService } from "@/services/notification.service";
import type { NotificationChannel, NotificationTarget } from "@prisma/client";

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

function normalizeTarget(raw: unknown): NotificationTarget | null {
  const value = String(raw ?? "").toUpperCase();
  if (value === "ALL" || value === "EVERYONE") return "EVERYONE";
  if (value === "COUNTRY" || value === "PROVINCE" || value === "USERS") {
    return value;
  }
  return null;
}

function normalizeChannels(raw: unknown): NotificationChannel[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(["PUSH", "EMAIL", "IN_APP"]);
  return [
    ...new Set(raw.map(String).filter((c) => allowed.has(c))),
  ] as NotificationChannel[];
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const {
      titleEn,
      titleAr,
      titleKu,
      titleTr,
      bodyEn,
      bodyAr,
      bodyKu,
      bodyTr,
      countryId,
      provinceId,
      userIds,
    } = body;

    const target = normalizeTarget(body.target);
    const channels = normalizeChannels(body.channels);

    if (!titleEn || !bodyEn || channels.length === 0 || !target) {
      return error("Missing required fields", 422, "VALIDATION");
    }

    if (
      (target === "COUNTRY" && !countryId) ||
      (target === "PROVINCE" && !provinceId)
    ) {
      return error(
        "Country/province required for this target",
        422,
        "VALIDATION"
      );
    }

    const linkData: Record<string, string> = {
      type: String(body.linkType || body.data?.type || "admin"),
      screen: String(body.screen || body.data?.screen || "ads"),
    };
    if (body.adId || body.data?.adId) {
      linkData.adId = String(body.adId || body.data.adId);
    }
    if (body.courseId || body.data?.courseId) {
      linkData.courseId = String(body.courseId || body.data.courseId);
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
      countryId: countryId || undefined,
      provinceId: provinceId || undefined,
      userIds: Array.isArray(userIds) ? userIds : undefined,
      createdById: auth.session.userId,
      data: linkData,
    });

    return json({ notification }, 201);
  } catch (e) {
    console.error("[admin/notifications] POST failed", e);
    const message =
      e instanceof Error ? e.message : "Failed to send notification";
    return error(message, 500, "BROADCAST_FAILED");
  }
}
