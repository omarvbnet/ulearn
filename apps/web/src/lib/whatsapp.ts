/**
 * Meta WhatsApp Cloud API integration.
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */

const GRAPH_API = "https://graph.facebook.com/v21.0";

export function getWhatsAppWebhookUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/webhooks/whatsapp`;
}

export function getWhatsAppVerifyToken(): string | undefined {
  return process.env.WHATSAPP_VERIFY_TOKEN;
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

/** Normalize to digits only for Meta (no + prefix). */
export function normalizeWhatsAppPhone(phone: string): string {
  return phone.replace(/\D/g, "");
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
        }>;
      };
    }>;
  }>;
};

export async function sendWhatsAppOtp(phone: string, code: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    if (process.env.NODE_ENV === "development") {
      console.info(`[DEV] WhatsApp OTP for ${phone}: ${code}`);
    }
    return;
  }

  const to = normalizeWhatsAppPhone(phone);
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;

  const body = templateName
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: process.env.WHATSAPP_OTP_TEMPLATE_LANG || "en",
          },
          components: buildTemplateComponents(code),
        },
      }
    : {
        messaging_product: "whatsapp",
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

  if (!res.ok) {
    const err = await res.text();
    console.error("[WhatsApp] send failed:", res.status, err);
    throw new Error("WHATSAPP_SEND_FAILED");
  }
}

function buildTemplateComponents(code: string) {
  const components: Array<Record<string, unknown>> = [
    {
      type: "body",
      parameters: [{ type: "text", text: code }],
    },
  ];

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
