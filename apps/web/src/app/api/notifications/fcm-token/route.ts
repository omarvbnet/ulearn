import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Register an FCM device token for push notifications (mobile app). */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { token } = (await request.json()) as { token?: string };
  if (!token || token.length < 10) return error("token is required", 422, "VALIDATION");

  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: { fcmTokens: true },
  });
  if (!user) return error("User not found", 404, "NOT_FOUND");

  if (!user.fcmTokens.includes(token)) {
    // Keep the most recent 5 tokens per user.
    const tokens = [...user.fcmTokens, token].slice(-5);
    await prisma.user.update({
      where: { id: auth.session.userId },
      data: { fcmTokens: tokens },
    });
  }

  return json({ success: true });
}

/** Remove an FCM token (e.g. on logout). */
export async function DELETE(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { token } = (await request.json()) as { token?: string };
  if (!token) return error("token is required", 422, "VALIDATION");

  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: { fcmTokens: true },
  });
  if (user) {
    await prisma.user.update({
      where: { id: auth.session.userId },
      data: { fcmTokens: user.fcmTokens.filter((t) => t !== token) },
    });
  }

  return json({ success: true });
}
