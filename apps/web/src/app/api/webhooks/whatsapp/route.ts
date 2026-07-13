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
 *
 * Subscribe to field: messages  (needed for delivery / failed status)
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
    console.error("[WhatsApp webhook] Invalid signature — check WHATSAPP_APP_SECRET matches Meta App Secret", {
      hasSignature: Boolean(signature),
      bodyLen: rawBody.length,
    });
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    console.error("[WhatsApp webhook] Bad JSON body");
    return new Response("Bad request", { status: 400 });
  }

  console.info("[WhatsApp webhook] received", {
    object: payload.object,
    entries: payload.entry?.length ?? 0,
  });

  if (payload.object !== "whatsapp_business_account") {
    return new Response("OK", { status: 200 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") {
        console.info("[WhatsApp webhook] ignored field", { field: change.field });
        continue;
      }

      const value = change.value;
      for (const msg of value?.messages ?? []) {
        console.info("[WhatsApp webhook] inbound", {
          from: msg.from,
          type: msg.type,
        });
      }

      const statuses = value?.statuses ?? [];
      if (statuses.length === 0 && !(value?.messages?.length)) {
        console.info("[WhatsApp webhook] messages field with no statuses/messages");
      }

      for (const status of statuses) {
        const err = status.errors?.[0];
        const line = {
          id: status.id,
          status: status.status,
          to: status.recipient_id
            ? `***${String(status.recipient_id).slice(-4)}`
            : null,
          errorCode: err?.code ?? null,
          errorTitle: err?.title ?? null,
          errorMessage: err?.message ?? null,
          errorDetails: err?.error_data?.details ?? null,
        };

        if (status.status === "failed" || status.status === "deleted") {
          console.error("[WhatsApp] DELIVERY FAILED", line);
        } else {
          console.info("[WhatsApp] delivery status", line);
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
}

/** Optional: expose callback URL for admin setup screens. */
export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "X-Webhook-URL": getWhatsAppWebhookUrl() },
  });
}
