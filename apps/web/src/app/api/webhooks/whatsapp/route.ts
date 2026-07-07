import {
  getWhatsAppWebhookUrl,
  verifyWebhookSignature,
  verifyWebhookSubscription,
  type WhatsAppWebhookPayload,
} from "@/lib/whatsapp";

/**
 * Meta WhatsApp webhook.
 *
 * Callback URL (Meta Developer Console):
 *   {NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp
 *
 * Verify token:
 *   WHATSAPP_VERIFY_TOKEN in .env (must match Meta exactly)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = verifyWebhookSubscription(searchParams);

  if (!result.ok) {
    return new Response("Forbidden", { status: 403 });
  }

  return new Response(result.challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  const valid = await verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") {
    return new Response("OK", { status: 200 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      for (const msg of value?.messages ?? []) {
        if (process.env.NODE_ENV === "development") {
          console.info("[WhatsApp webhook] message", {
            from: msg.from,
            type: msg.type,
            text: msg.text?.body,
          });
        }
      }

      for (const status of value?.statuses ?? []) {
        if (process.env.NODE_ENV === "development") {
          console.info("[WhatsApp webhook] status", {
            id: status.id,
            status: status.status,
            to: status.recipient_id,
          });
        }
      }
    }
  }

  // Meta expects 200 quickly; process heavy work async if needed later.
  return new Response("OK", { status: 200 });
}

/** Optional: expose callback URL for admin setup screens. */
export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "X-Webhook-URL": getWhatsAppWebhookUrl() },
  });
}
