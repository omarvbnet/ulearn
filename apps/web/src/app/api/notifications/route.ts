import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { NotificationService } from "@/services/notification.service";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const [notifications, unread] = await Promise.all([
    NotificationService.getUserNotifications(auth.session.userId),
    prisma.userNotification.count({
      where: { userId: auth.session.userId, isRead: false },
    }),
  ]);

  return json({ notifications, unread });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const { id, all } = body as { id?: string; all?: boolean };

  if (all) {
    await prisma.userNotification.updateMany({
      where: { userId: auth.session.userId, isRead: false },
      data: { isRead: true },
    });
    return json({ ok: true });
  }

  if (!id) return error("id or all is required", 422, "VALIDATION");

  await NotificationService.markRead(id, auth.session.userId);
  return json({ ok: true });
}
