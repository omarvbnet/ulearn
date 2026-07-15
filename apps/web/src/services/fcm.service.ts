import { GoogleAuth, type JWTInput } from "google-auth-library";

type FcmCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

let cachedAuth: GoogleAuth | null = null;
let cachedProjectId: string | null = null;

function loadCredentials(): FcmCredentials | null {
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (parsed.client_email && parsed.private_key) {
        return {
          projectId:
            parsed.project_id ||
            process.env.FIREBASE_PROJECT_ID ||
            "u-learn-5eb31",
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch (err) {
      console.error("[FCM] Invalid FIREBASE_SERVICE_ACCOUNT_JSON", err);
    }
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || "u-learn-5eb31";

  if (clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

function getAuth(): { auth: GoogleAuth; projectId: string } | null {
  if (cachedAuth && cachedProjectId) {
    return { auth: cachedAuth, projectId: cachedProjectId };
  }

  const creds = loadCredentials();
  if (!creds) return null;

  const credentials: JWTInput = {
    client_email: creds.clientEmail,
    private_key: creds.privateKey,
    project_id: creds.projectId,
  };

  cachedAuth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  cachedProjectId = creds.projectId;
  return { auth: cachedAuth, projectId: cachedProjectId };
}

async function getAccessToken(): Promise<{ token: string; projectId: string } | null> {
  const ctx = getAuth();
  if (!ctx) return null;
  const client = await ctx.auth.getClient();
  const tokenRes = await client.getAccessToken();
  const token = typeof tokenRes === "string" ? tokenRes : tokenRes?.token;
  if (!token) return null;
  return { token, projectId: ctx.projectId };
}

export function isFcmConfigured(): boolean {
  return loadCredentials() !== null;
}

function parseFcmError(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: {
        status?: string;
        message?: string;
        details?: Array<{ errorCode?: string; reason?: string }>;
      };
    };
    const detail = parsed.error?.details?.find((d) => d.errorCode || d.reason);
    return (
      detail?.errorCode ||
      detail?.reason ||
      parsed.error?.status ||
      parsed.error?.message ||
      `HTTP_${status}`
    );
  } catch {
    return text ? text.slice(0, 180) : `HTTP_${status}`;
  }
}

/** Send one FCM HTTP v1 message. */
async function sendToToken(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<{ status: "ok" | "invalid" | "error"; error?: string }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          android: {
            priority: "high",
            notification: {
              sound: "default",
              defaultSound: true,
            },
          },
          apns: {
            headers: {
              "apns-priority": "10",
              "apns-push-type": "alert",
            },
            payload: {
              aps: {
                alert: { title, body },
                sound: "default",
                badge: 1,
              },
            },
          },
        },
      }),
    }
  );

  if (res.ok) return { status: "ok" };

  const text = await res.text().catch(() => "");
  console.error(`[FCM] v1 send failed ${res.status}: ${text}`);
  const error = parseFcmError(res.status, text);

  const deadToken =
    text.includes('"errorCode": "UNREGISTERED"') ||
    text.includes('"status": "UNREGISTERED"') ||
    text.includes("Requested entity was not found") ||
    (res.status === 404 && text.includes("NOT_FOUND"));

  return { status: deadToken ? "invalid" : "error", error };
}

/**
 * Send push via FCM HTTP v1 (service account).
 * Legacy FCM_SERVER_KEY is no longer supported by Firebase Console.
 */
export async function sendFcmPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<{
  sent: number;
  failed: number;
  invalidTokens: string[];
  configured: boolean;
  lastError?: string;
}> {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [], configured: isFcmConfigured() };
  }

  const auth = await getAccessToken();
  if (!auth) {
    console.error(
      "[FCM] Missing Firebase service account credentials — push skipped. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY."
    );
    return {
      sent: 0,
      failed: unique.length,
      invalidTokens: [],
      configured: false,
      lastError: "MISSING_SERVICE_ACCOUNT",
    };
  }

  const stringData: Record<string, string> = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      stringData[key] = typeof value === "string" ? value : String(value);
    }
  }

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];
  let lastError: string | undefined;

  const concurrency = 8;
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (token) => {
        try {
          const result = await sendToToken(
            auth.token,
            auth.projectId,
            token,
            title,
            body,
            stringData
          );
          return { token, ...result };
        } catch (err) {
          console.error("[FCM] send error:", err);
          return {
            token,
            status: "error" as const,
            error: err instanceof Error ? err.message : "SEND_EXCEPTION",
          };
        }
      })
    );

    for (const r of results) {
      if (r.status === "ok") {
        sent += 1;
      } else {
        failed += 1;
        if (r.error) lastError = r.error;
        if (r.status === "invalid") invalidTokens.push(r.token);
      }
    }
  }

  console.info(
    `[FCM] v1 sent ${sent}/${unique.length} (failed ${failed}, invalid ${invalidTokens.length}) project=${auth.projectId}${lastError ? ` lastError=${lastError}` : ""}`
  );

  return {
    sent,
    failed,
    invalidTokens,
    configured: true,
    lastError,
  };
}
