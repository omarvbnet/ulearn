import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { isFcmConfigured, sendFcmPush } from "@/services/fcm.service";
import { prisma } from "@/lib/prisma";

/**
 * Diagnose FCM/APNs setup. THIRD_PARTY_AUTH_ERROR = APNs key missing/wrong in Firebase Console
 * (not Vercel service-account env vars).
 */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const hasJson = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
  const hasEmail = Boolean(process.env.FIREBASE_CLIENT_EMAIL?.trim());
  const hasKey = Boolean(process.env.FIREBASE_PRIVATE_KEY?.trim());
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || "u-learn-5eb31";

  const usersWithTokens = await prisma.user.count({
    where: { fcmTokens: { isEmpty: false } },
  });

  return json({
    fcmConfigured: isFcmConfigured(),
    projectId,
    credentials: {
      FIREBASE_SERVICE_ACCOUNT_JSON: hasJson,
      FIREBASE_CLIENT_EMAIL: hasEmail,
      FIREBASE_PRIVATE_KEY: hasKey,
    },
    usersWithTokens,
    iosChecklist: {
      firebaseConsole:
        "Project settings → Cloud Messaging → Apple apps → com.ulearn.mobile → APNs Authentication Key must show a Key ID",
      appleKey:
        "Apple Developer → Keys → key must have Apple Push Notifications service (APNs) enabled (not App Store Connect API)",
      teamId: "Must be 28YT228VJ4 (same as Xcode DEVELOPMENT_TEAM)",
      bundleId: "com.ulearn.mobile",
      note:
        "THIRD_PARTY_AUTH_ERROR means Firebase cannot auth to Apple. Fix APNs Auth Key in Firebase — Vercel env vars are already working if sends reach this error.",
    },
  });
}

/** Optional: POST { token } to probe FCM with one device token and return the raw error. */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  if (!isFcmConfigured()) {
    return error(
      "Firebase service account env vars missing on this server",
      503,
      "FCM_NOT_CONFIGURED"
    );
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string };
  let token = body.token?.trim();

  if (!token) {
    const user = await prisma.user.findFirst({
      where: { fcmTokens: { isEmpty: false } },
      select: { fcmTokens: true },
      orderBy: { updatedAt: "desc" },
    });
    token = user?.fcmTokens[0];
  }

  if (!token) {
    return error("No FCM token available to test", 422, "NO_TOKEN");
  }

  const result = await sendFcmPush(
    [token],
    "U Learn FCM probe",
    "If you see this, APNs + FCM are configured correctly."
  );

  return json({
    ok: result.sent > 0,
    ...result,
    hint:
      result.lastError === "THIRD_PARTY_AUTH_ERROR" ||
      result.lastError === "BadEnvironmentKeyInToken" ||
      result.lastError === "InvalidProviderToken"
        ? "Upload a valid APNs Authentication Key (.p8) for com.ulearn.mobile in Firebase → Cloud Messaging. Key ID + Team ID 28YT228VJ4 must match Apple Developer."
        : result.sent > 0
          ? "FCM accepted the message — check the iPhone notification settings / Focus mode."
          : undefined,
  });
}
