/**
 * Meta WhatsApp Cloud API integration.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages
 */

const GRAPH_API = "https://graph.facebook.com/v23.0";

/** First non-empty env value among aliases (supports legacy May 2026 names). */
function envFirst(...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function getWhatsAppWebhookUrl(): string {
  const raw =
    envFirst("WHATSAPP_WEBHOOK_BASE_URL", "NEXT_PUBLIC_APP_URL") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000";
  // Never advertise localhost as the Meta callback when a Vercel host exists.
  const base =
    /localhost|127\.0\.0\.1/i.test(raw) && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : raw;
  return `${base.replace(/\/$/, "")}/api/webhooks/whatsapp`;
}

export function getWhatsAppVerifyToken(): string | undefined {
  // Prefer webhook-prefixed name (May config), then short name.
  return envFirst(
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "WHATSAPP_VERIFY_TOKEN"
  );
}

export function getWhatsAppPhoneNumberId(): string | undefined {
  // Prefer CLOUD_* (May config) then current name.
  return envFirst(
    "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
    "WHATSAPP_PHONE_NUMBER_ID"
  );
}

export function getWhatsAppAccessToken(): string | undefined {
  return envFirst(
    "WHATSAPP_CLOUD_ACCESS_TOKEN",
    "WHATSAPP_ACCESS_TOKEN"
  );
}

export function getWhatsAppOtpTemplateName(): string | undefined {
  return envFirst("WHATSAPP_OTP_TEMPLATE_NAME");
}

export function getWhatsAppOtpTemplateLang(): string {
  // Prefer TEMPLATE_LANGUAGE (May), then LANG. Normalize ar_AR → ar.
  return normalizeWhatsAppTemplateLang(
    envFirst(
      "WHATSAPP_OTP_TEMPLATE_LANGUAGE",
      "WHATSAPP_OTP_TEMPLATE_LANG"
    ) || "ar"
  );
}

export type WhatsAppSenderStatus = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  accountMode: string | null;
  nameStatus: string | null;
  newNameStatus: string | null;
  codeVerificationStatus: string | null;
  qualityRating: string | null;
  status: string | null;
};

/**
 * Fetch Cloud API phone readiness. Display name must be APPROVED or Meta
 * often accepts the request then drops it (Insights stays at 0 sends).
 */
export async function fetchWhatsAppSenderStatus(): Promise<WhatsAppSenderStatus> {
  const phoneNumberId = getWhatsAppPhoneNumberId();
  const accessToken = getWhatsAppAccessToken();
  if (!phoneNumberId || !accessToken) {
    throw new WhatsAppSendError(
      "WhatsApp OTP is not configured on the server",
      "WHATSAPP_NOT_CONFIGURED"
    );
  }

  const res = await fetch(
    `${GRAPH_API}/${phoneNumberId}?fields=id,display_phone_number,verified_name,account_mode,name_status,new_name_status,code_verification_status,quality_rating,status`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const raw = await res.text();
  if (!res.ok) {
    throw new WhatsAppSendError(
      "Could not read WhatsApp phone number status from Meta",
      "WHATSAPP_SENDER_STATUS_FAILED",
      raw.slice(0, 500)
    );
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  return {
    id: String(data.id ?? phoneNumberId),
    displayPhoneNumber: (data.display_phone_number as string) ?? null,
    verifiedName: (data.verified_name as string) ?? null,
    accountMode: (data.account_mode as string) ?? null,
    nameStatus: (data.name_status as string) ?? null,
    newNameStatus: (data.new_name_status as string) ?? null,
    codeVerificationStatus: (data.code_verification_status as string) ?? null,
    qualityRating: (data.quality_rating as string) ?? null,
    status: (data.status as string) ?? null,
  };
}

export async function assertWhatsAppSenderReady(): Promise<WhatsAppSenderStatus> {
  const sender = await fetchWhatsAppSenderStatus();
  console.info("[WhatsApp] sender status", {
    display: sender.displayPhoneNumber,
    mode: sender.accountMode,
    nameStatus: sender.nameStatus,
    newNameStatus: sender.newNameStatus,
    connected: sender.status,
  });

  const name = (sender.nameStatus || "").toUpperCase();
  if (name && name !== "APPROVED") {
    throw new WhatsAppSendError(
      `WhatsApp display name is ${sender.nameStatus} (need APPROVED). Meta accepts OTP requests then drops them — Insights stay at 0. Fix display name in WhatsApp Manager for ${sender.displayPhoneNumber || "this number"}.`,
      "WHATSAPP_DISPLAY_NAME_NOT_APPROVED",
      JSON.stringify({
        nameStatus: sender.nameStatus,
        newNameStatus: sender.newNameStatus,
        displayPhoneNumber: sender.displayPhoneNumber,
      })
    );
  }

  if (
    sender.accountMode &&
    sender.accountMode.toUpperCase() !== "LIVE"
  ) {
    throw new WhatsAppSendError(
      `WhatsApp phone account_mode is ${sender.accountMode} (need LIVE)`,
      "WHATSAPP_ACCOUNT_NOT_LIVE"
    );
  }

  return sender;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(getWhatsAppPhoneNumberId() && getWhatsAppAccessToken());
}

/** Which env keys were resolved (names only — safe to log). */
export function getWhatsAppEnvResolution(): Record<string, string | null> {
  return {
    phoneNumberId: whichEnv(
      "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
      "WHATSAPP_PHONE_NUMBER_ID"
    ),
    accessToken: whichEnv(
      "WHATSAPP_CLOUD_ACCESS_TOKEN",
      "WHATSAPP_ACCESS_TOKEN"
    ),
    templateName: whichEnv("WHATSAPP_OTP_TEMPLATE_NAME"),
    templateLang: whichEnv(
      "WHATSAPP_OTP_TEMPLATE_LANGUAGE",
      "WHATSAPP_OTP_TEMPLATE_LANG"
    ),
    buttonMode: whichEnv("WHATSAPP_OTP_BUTTON_MODE"),
    buttonIndex: whichEnv("WHATSAPP_OTP_URL_BUTTON_INDEX"),
    bodyVars: whichEnv("WHATSAPP_OTP_TEMPLATE_BODY_VARS"),
    useButton: whichEnv("WHATSAPP_OTP_TEMPLATE_USE_BUTTON"),
    webhookBase: whichEnv("WHATSAPP_WEBHOOK_BASE_URL", "NEXT_PUBLIC_APP_URL"),
    verifyToken: whichEnv(
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      "WHATSAPP_VERIFY_TOKEN"
    ),
  };
}

function whichEnv(...keys: string[]): string | null {
  for (const key of keys) {
    if (process.env[key]?.trim()) return key;
  }
  return null;
}

/** Meta webhook subscription verification (GET). */
export function verifyWebhookSubscription(searchParams: URLSearchParams): {
  ok: boolean;
  challenge?: string;
} {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expected = getWhatsAppVerifyToken();

  if (!expected) {
    return { ok: false };
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return { ok: true, challenge };
  }

  return { ok: false };
}

/** Validate X-Hub-Signature-256 when WHATSAPP_APP_SECRET is set. */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;

  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computed, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Normalize to Meta digits-only format (no +).
 * Converts common local Iraqi mobiles `07xxxxxxxx` → `9647xxxxxxxx`.
 */
export function normalizeWhatsAppPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");

  // Strip leading 00 international prefix.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Iraq local mobile → E.164 without +
  if (/^07\d{9}$/.test(digits)) {
    digits = `964${digits.slice(1)}`;
  }

  return digits;
}

export type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body?: string };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
          errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
          }>;
        }>;
      };
    }>;
  }>;
};

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

export type WhatsAppSendResult = {
  messageId: string | null;
  messageStatus: string | null;
  to: string;
  template: string | null;
  lang: string | null;
};

/**
 * Send OTP via Meta WhatsApp Cloud API.
 * Production requires an approved Authentication template + credentials.
 */
export async function sendWhatsAppOtp(
  phone: string,
  code: string
): Promise<WhatsAppSendResult> {
  const phoneNumberId = getWhatsAppPhoneNumberId();
  const accessToken = getWhatsAppAccessToken();

  if (!phoneNumberId || !accessToken) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[OTP fallback — WhatsApp not configured] ${phone}: ${code}`);
      return {
        messageId: null,
        messageStatus: null,
        to: phone,
        template: null,
        lang: null,
      };
    }
    throw new WhatsAppSendError(
      "WhatsApp OTP is not configured on the server",
      "WHATSAPP_NOT_CONFIGURED"
    );
  }

  const to = normalizeWhatsAppPhone(phone);
  // International WhatsApp numbers are typically 10–15 digits with country code.
  if (to.length < 10 || to.length > 15) {
    throw new WhatsAppSendError(
      "Phone must include country code, e.g. +9647XXXXXXXX",
      "INVALID_PHONE"
    );
  }
  // Reject bare local numbers that never got a country code (except already mapped 07→964).
  if (/^0\d+$/.test(to)) {
    throw new WhatsAppSendError(
      "Phone must include country code, e.g. +9647XXXXXXXX",
      "INVALID_PHONE"
    );
  }

  const templateName = getWhatsAppOtpTemplateName();
  const templateLang = getWhatsAppOtpTemplateLang();

  if (!templateName && process.env.NODE_ENV === "production") {
    throw new WhatsAppSendError(
      "WHATSAPP_OTP_TEMPLATE_NAME is required in production",
      "WHATSAPP_TEMPLATE_MISSING"
    );
  }

  // Fail fast when Meta will accept-but-drop (display name not approved).
  await assertWhatsAppSenderReady();

  console.info("[WhatsApp] OTP env keys", getWhatsAppEnvResolution());
  console.info("[WhatsApp] sending template", {
    template: templateName,
    lang: templateLang,
    to: `***${to.slice(-4)}`,
    useButton: shouldIncludeOtpUrlButton(),
  });

  // Meta Authentication + Copy code payload.
  // @see https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/copy-code-button-authentication-templates
  const body = templateName
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: buildTemplateComponents(code),
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: `U Learn verification code: ${code}\n\nThis code expires in 5 minutes. Do not share it with anyone.`,
        },
      };

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error("[WhatsApp] send failed:", res.status, raw);
    console.error("[WhatsApp] OTP env keys", getWhatsAppEnvResolution());
    let hint = "";
    if (raw.includes("132001") || raw.includes("does not exist in")) {
      hint =
        ` Template "${templateName}" was not found for language "${templateLang}". Set WHATSAPP_OTP_TEMPLATE_LANGUAGE (or WHATSAPP_OTP_TEMPLATE_LANG) to the exact code in WhatsApp Manager (often "ar").`;
    }
    throw new WhatsAppSendError(
      `WhatsApp API rejected the OTP message.${hint}`,
      "WHATSAPP_SEND_FAILED",
      raw.slice(0, 800)
    );
  }

  let messageId: string | null = null;
  let messageStatus: string | null = null;
  let waId: string | null = null;
  try {
    const parsed = JSON.parse(raw) as {
      messages?: Array<{ id?: string; message_status?: string }>;
      contacts?: Array<{ wa_id?: string; input?: string }>;
    };
    messageId = parsed.messages?.[0]?.id ?? null;
    messageStatus = parsed.messages?.[0]?.message_status ?? null;
    waId = parsed.contacts?.[0]?.wa_id ?? null;
  } catch {
    /* ignore */
  }

  const useButton = shouldIncludeOtpUrlButton();
  console.info("[WhatsApp] OTP env keys", getWhatsAppEnvResolution());
  console.info("[WhatsApp] OTP accepted by Meta", {
    to: `***${to.slice(-4)}`,
    toLen: to.length,
    waId: waId ? `***${waId.slice(-4)}` : null,
    template: templateName || null,
    lang: templateName ? templateLang : null,
    useButton,
    buttonIndex: getOtpUrlButtonIndex(),
    bodyVars: getOtpBodyVarCount(),
    messageId,
    messageStatus,
    raw: raw.slice(0, 500),
  });

  if (messageStatus === "held_for_quality_assessment") {
    console.warn(
      "[WhatsApp] Message HELD for template quality assessment — may never reach the phone until Meta releases it"
    );
  }

  return {
    messageId,
    messageStatus,
    to: `***${to.slice(-4)}`,
    template: templateName || null,
    lang: templateName ? templateLang : null,
  };
}

function getOtpBodyVarCount(): number {
  const raw = envFirst("WHATSAPP_OTP_TEMPLATE_BODY_VARS") || "1";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3) : 1;
}

function getOtpUrlButtonIndex(): string {
  return envFirst("WHATSAPP_OTP_URL_BUTTON_INDEX") || "0";
}

function shouldIncludeOtpUrlButton(): boolean {
  // Legacy: WHATSAPP_OTP_BUTTON_MODE=auth|url|copy → include button
  // Legacy/new: WHATSAPP_OTP_TEMPLATE_USE_BUTTON=false → skip
  const useButton = envFirst("WHATSAPP_OTP_TEMPLATE_USE_BUTTON");
  if (useButton === "false") return false;
  if (useButton === "true") return true;
  const mode = (envFirst("WHATSAPP_OTP_BUTTON_MODE") || "auth").toLowerCase();
  if (mode === "none" || mode === "off" || mode === "body") return false;
  return true; // auth | url | copy | default
}

function buildTemplateComponents(code: string) {
  const bodyVars = getOtpBodyVarCount();
  const bodyParams = Array.from({ length: bodyVars }, () => ({
    type: "text",
    text: code,
  }));

  const components: Array<Record<string, unknown>> = [
    {
      type: "body",
      parameters: bodyParams,
    },
  ];

  // Copy-code / auth URL button — OTP must be passed again.
  if (shouldIncludeOtpUrlButton()) {
    components.push({
      type: "button",
      sub_type: "url",
      index: getOtpUrlButtonIndex(),
      parameters: [{ type: "text", text: code }],
    });
  }

  return components;
}

/** Normalize env language to Meta template language codes. */
function normalizeWhatsAppTemplateLang(lang: string): string {
  const v = lang.trim();
  const lower = v.toLowerCase().replace(/-/g, "_");
  // Meta UI "Arabic" => API code "ar" (NOT ar_AR / ar_EG / …).
  if (
    lower === "arabic" ||
    lower === "ar" ||
    lower.startsWith("ar_")
  ) {
    return "ar";
  }
  return v;
}
