import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { getWhatsAppWebhookUrl, isWhatsAppConfigured } from "@/lib/whatsapp";

const GRAPH_API = "https://graph.facebook.com/v21.0";

/**
 * Admin: diagnose WhatsApp Cloud API setup (no secrets returned).
 * GET /api/admin/whatsapp/status
 */
export async function GET(request: Request) {
  const cron = request.headers.get("authorization");
  const cronOk =
    Boolean(process.env.CRON_SECRET) &&
    cron === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk) {
    const auth = await requireAuth(ADMIN_ROLES);
    if (auth.error) return auth.error;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "";
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "";
  const wabaIdEnv = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "";
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim() || "";
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || "ar";
  const useButton = process.env.WHATSAPP_OTP_TEMPLATE_USE_BUTTON !== "false";
  const verifyTokenSet = Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim());
  const appSecretSet = Boolean(process.env.WHATSAPP_APP_SECRET?.trim());

  const env = {
    configured: isWhatsAppConfigured(),
    phoneNumberIdSet: Boolean(phoneNumberId),
    accessTokenSet: Boolean(accessToken),
    wabaIdSet: Boolean(wabaIdEnv),
    templateName: templateName || null,
    templateLang,
    useButton,
    verifyTokenSet,
    appSecretSet,
    webhookUrl: getWhatsAppWebhookUrl(),
  };

  if (!phoneNumberId || !accessToken) {
    return json({
      ok: false,
      issue: "WHATSAPP_NOT_CONFIGURED",
      env,
      checklist: [
        "Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN on Vercel",
        "Redeploy after changing env vars",
      ],
    });
  }

  const headers = { Authorization: `Bearer ${accessToken}` };

  const phoneRes = await fetch(
    `${GRAPH_API}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,is_official_business_account,account_mode,name_status,messaging_limit_tier,throughput`,
    { headers }
  );
  const phoneJson = (await phoneRes.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  // Prefer explicit WABA id (token often cannot expand whatsapp_business_account).
  let wabaId = wabaIdEnv || null;
  let wabaMeta: Record<string, unknown> | null = null;
  let wabaError: { message?: string; code?: number } | null = null;

  if (!wabaId) {
    const wabaRes = await fetch(
      `${GRAPH_API}/${phoneNumberId}?fields=whatsapp_business_account{id,name,account_review_status,business_verification_status}`,
      { headers }
    );
    const wabaJson = (await wabaRes.json().catch(() => ({}))) as {
      whatsapp_business_account?: {
        id?: string;
        name?: string;
        account_review_status?: string;
        business_verification_status?: string;
      };
      error?: { message?: string; code?: number };
    };
    if (wabaJson.error) {
      wabaError = wabaJson.error;
    } else if (wabaJson.whatsapp_business_account?.id) {
      wabaId = wabaJson.whatsapp_business_account.id;
      wabaMeta = wabaJson.whatsapp_business_account as Record<string, unknown>;
    }
  }

  if (wabaId && !wabaMeta) {
    const detailRes = await fetch(
      `${GRAPH_API}/${wabaId}?fields=id,name,account_review_status,business_verification_status`,
      { headers }
    );
    const detail = (await detailRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!detail.error) wabaMeta = detail;
    else
      wabaError =
        (detail.error as { message?: string; code?: number }) || wabaError;
  }

  let template: Record<string, unknown> | null = null;
  let templatesError: string | null = null;
  let matchingLanguages: string[] = [];

  if (wabaId && templateName) {
    const tplRes = await fetch(
      `${GRAPH_API}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}&limit=20`,
      { headers }
    );
    const tplJson = (await tplRes.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>;
      error?: { message?: string };
    };
    if (tplJson.error) {
      templatesError = tplJson.error.message || "template_fetch_failed";
    } else {
      matchingLanguages = (tplJson.data || []).map((t) => String(t.language));
      template =
        tplJson.data?.find(
          (t) =>
            String(t.name) === templateName &&
            String(t.language) === templateLang
        ) ||
        tplJson.data?.find((t) => String(t.name) === templateName) ||
        null;
    }
  } else if (!wabaId) {
    templatesError =
      "Set WHATSAPP_BUSINESS_ACCOUNT_ID in Vercel (WhatsApp Manager → account ID)";
  }

  let subscribedApps: unknown = null;
  if (wabaId) {
    const subRes = await fetch(`${GRAPH_API}/${wabaId}/subscribed_apps`, {
      headers,
    });
    subscribedApps = await subRes.json().catch(() => null);
  }

  const checklist: string[] = [];
  const phoneError = phoneJson.error as
    | { message?: string; code?: number }
    | undefined;

  if (phoneError) {
    checklist.push(
      `Phone number API error: ${phoneError.message || phoneError.code}`
    );
  }

  const accountMode = String(phoneJson.account_mode || "").toUpperCase();
  if (accountMode === "SANDBOX") {
    checklist.push(
      "Phone is in SANDBOX — only allow-listed numbers receive messages"
    );
  }

  if (!wabaId) {
    checklist.push(
      "Add WHATSAPP_BUSINESS_ACCOUNT_ID so we can verify the otp template"
    );
  }

  if (!template) {
    checklist.push(
      `Template "${templateName}" / lang "${templateLang}" not readable via API` +
        (matchingLanguages.length
          ? ` (found languages: ${matchingLanguages.join(", ")})`
          : "")
    );
  } else {
    if (String(template.language) !== templateLang) {
      checklist.push(
        `Language mismatch: env=${templateLang}, template=${String(template.language)} — set WHATSAPP_OTP_TEMPLATE_LANG exactly`
      );
    }
    if (String(template.status) !== "APPROVED") {
      checklist.push(
        `Template status is ${String(template.status)} (need APPROVED)`
      );
    }
    if (String(template.category).toUpperCase() !== "AUTHENTICATION") {
      checklist.push(
        `Template category is ${String(template.category)} — OTP must be AUTHENTICATION`
      );
    }
  }

  checklist.push(
    "WhatsApp Manager → Overview/Billing: add a payment method (131042 = accepted but never delivered)"
  );
  checklist.push(
    "Meta webhook must subscribe to messages on https://ulearn.usmart-iot.com/api/webhooks/whatsapp"
  );
  checklist.push(
    "WABA must have your app subscribed (POST /{WABA_ID}/subscribed_apps) or delivery status webhooks never arrive"
  );
  checklist.push(
    "WHATSAPP_APP_SECRET must match Meta App → Settings → Basic → App Secret (wrong secret = webhook 401, no delivery logs)"
  );
  checklist.push(
    "After OTP accepted, check Vercel for [WhatsApp] DELIVERY FAILED — that code is the real reason"
  );
  checklist.push(
    "Open WhatsApp on the recipient primary phone (Auth OTP hidden on linked Web/Desktop)"
  );

  const ok =
    !phoneError &&
    accountMode === "LIVE" &&
    Boolean(template) &&
    String(template?.status) === "APPROVED";

  return json({
    ok,
    diagnosis: ok
      ? "API + template look healthy. If OTP still missing, check payment method and DELIVERY FAILED webhook logs."
      : "Sender number is configured, but template/WABA could not be fully verified — or delivery is blocked after accept (usually payment / webhook).",
    env,
    phone: phoneError
      ? { error: phoneError }
      : {
          displayPhoneNumber: phoneJson.display_phone_number ?? null,
          verifiedName: phoneJson.verified_name ?? null,
          qualityRating: phoneJson.quality_rating ?? null,
          codeVerificationStatus: phoneJson.code_verification_status ?? null,
          accountMode: phoneJson.account_mode ?? null,
          messagingLimitTier: phoneJson.messaging_limit_tier ?? null,
          throughput: phoneJson.throughput ?? null,
        },
    waba: wabaId
      ? {
          id: wabaId,
          name: wabaMeta?.name ?? null,
          accountReviewStatus: wabaMeta?.account_review_status ?? null,
          businessVerificationStatus:
            wabaMeta?.business_verification_status ?? null,
          error: wabaError,
        }
      : { error: wabaError },
    template: template
      ? {
          name: template.name,
          language: template.language,
          status: template.status,
          category: template.category,
          components: template.components,
        }
      : null,
    matchingLanguages,
    templatesError,
    subscribedApps,
    checklist,
  });
}
