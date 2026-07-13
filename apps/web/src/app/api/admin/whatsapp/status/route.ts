import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { isWhatsAppConfigured } from "@/lib/whatsapp";

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
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim() || "";
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || "ar";
  const useButton = process.env.WHATSAPP_OTP_TEMPLATE_USE_BUTTON !== "false";
  const verifyTokenSet = Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim());
  const appSecretSet = Boolean(process.env.WHATSAPP_APP_SECRET?.trim());
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";

  const env = {
    configured: isWhatsAppConfigured(),
    phoneNumberIdSet: Boolean(phoneNumberId),
    accessTokenSet: Boolean(accessToken),
    templateName: templateName || null,
    templateLang,
    useButton,
    verifyTokenSet,
    appSecretSet,
    webhookUrl: appUrl
      ? `${appUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`
      : null,
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

  const phoneRes = await fetch(
    `${GRAPH_API}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,is_official_business_account,account_mode,name_status,new_name_status,messaging_limit_tier`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const phoneJson = (await phoneRes.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const wabaRes = await fetch(
    `${GRAPH_API}/${phoneNumberId}?fields=whatsapp_business_account{id,name,account_review_status,business_verification_status}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
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

  const wabaId = wabaJson.whatsapp_business_account?.id;
  let template: Record<string, unknown> | null = null;
  let templatesError: string | null = null;

  if (wabaId && templateName) {
    const tplRes = await fetch(
      `${GRAPH_API}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}&limit=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const tplJson = (await tplRes.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>;
      error?: { message?: string };
    };
    if (tplJson.error) {
      templatesError = tplJson.error.message || "template_fetch_failed";
    } else {
      const match =
        tplJson.data?.find(
          (t) =>
            String(t.name) === templateName &&
            String(t.language) === templateLang
        ) ||
        tplJson.data?.find((t) => String(t.name) === templateName) ||
        null;
      template = match;
    }
  }

  const checklist: string[] = [];
  const phoneError = phoneJson.error as { message?: string; code?: number } | undefined;
  if (phoneError) {
    checklist.push(`Phone number API error: ${phoneError.message || phoneError.code}`);
  }
  if (String(phoneJson.account_mode || "").toUpperCase() === "SANDBOX") {
    checklist.push("Phone is in SANDBOX — only allow-listed numbers receive messages");
  }
  if (!template) {
    checklist.push(
      `Template "${templateName}" / lang "${templateLang}" not found or not readable`
    );
  } else if (String(template.status) !== "APPROVED") {
    checklist.push(`Template status is ${String(template.status)} (need APPROVED)`);
  } else if (String(template.category).toUpperCase() !== "AUTHENTICATION") {
    checklist.push(
      `Template category is ${String(template.category)} — OTP should be AUTHENTICATION`
    );
  }
  if (!verifyTokenSet || !appUrl) {
    checklist.push(
      "Configure webhook + WHATSAPP_VERIFY_TOKEN to see DELIVERY FAILED reasons"
    );
  }
  checklist.push(
    "Meta Developer App must be Live (not Development) or recipient must be a tester/allow-listed"
  );
  checklist.push(
    "WhatsApp Manager → add a valid payment method (error 131042 blocks delivery after accept)"
  );
  checklist.push(
    "Open WhatsApp on the primary phone for +964… (Auth OTP is hidden on linked devices)"
  );

  return json({
    ok: checklist.length <= 3 && Boolean(template),
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
        },
    waba: wabaJson.whatsapp_business_account
      ? {
          id: wabaJson.whatsapp_business_account.id ?? null,
          name: wabaJson.whatsapp_business_account.name ?? null,
          accountReviewStatus:
            wabaJson.whatsapp_business_account.account_review_status ?? null,
          businessVerificationStatus:
            wabaJson.whatsapp_business_account.business_verification_status ??
            null,
        }
      : { error: wabaJson.error ?? null },
    template: template
      ? {
          name: template.name,
          language: template.language,
          status: template.status,
          category: template.category,
          components: template.components,
        }
      : null,
    templatesError,
    checklist,
  });
}
