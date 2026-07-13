/**
 * Meta WhatsApp Cloud API integration.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages
 */

const GRAPH_API = "https://graph.facebook.com/v21.0";

export function getWhatsAppWebhookUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/webhooks/whatsapp`;
}

export function getWhatsAppVerifyToken(): string | undefined {
  return process.env.WHATSAPP_VERIFY_TOKEN;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() &&
      process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  );
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
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();

  if (!phoneNumberId || !accessToken) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[OTP fallback — WhatsApp not configured] ${phone}: ${code}`);
      return { messageId: null, to: phone, template: null, lang: null };
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

  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim();
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || "ar";

  if (!templateName && process.env.NODE_ENV === "production") {
    throw new WhatsAppSendError(
      "WHATSAPP_OTP_TEMPLATE_NAME is required in production",
      "WHATSAPP_TEMPLATE_MISSING"
    );
  }

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
    throw new WhatsAppSendError(
      "WhatsApp API rejected the OTP message",
      "WHATSAPP_SEND_FAILED",
      raw.slice(0, 800)
    );
  }

  let messageId: string | null = null;
  let waId: string | null = null;
  try {
    const parsed = JSON.parse(raw) as {
      messages?: Array<{ id?: string }>;
      contacts?: Array<{ wa_id?: string; input?: string }>;
    };
    messageId = parsed.messages?.[0]?.id ?? null;
    waId = parsed.contacts?.[0]?.wa_id ?? null;
  } catch {
    /* ignore */
  }

  console.info("[WhatsApp] OTP accepted by Meta", {
    to: `***${to.slice(-4)}`,
    toLen: to.length,
    waId: waId ? `***${waId.slice(-4)}` : null,
    template: templateName || null,
    lang: templateName ? templateLang : null,
    useButton: process.env.WHATSAPP_OTP_TEMPLATE_USE_BUTTON !== "false",
    messageId,
  });

  return {
    messageId,
    to: `***${to.slice(-4)}`,
    template: templateName || null,
    lang: templateName ? templateLang : null,
  };
}

function buildTemplateComponents(code: string) {
  const components: Array<Record<string, unknown>> = [
    {
      type: "body",
      parameters: [{ type: "text", text: code }],
    },
  ];

  // Copy-code Authentication templates require the OTP again on the URL button.
  // Set WHATSAPP_OTP_TEMPLATE_USE_BUTTON=false only for body-only templates.
  if (process.env.WHATSAPP_OTP_TEMPLATE_USE_BUTTON !== "false") {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: code }],
    });
  }

  return components;
}
