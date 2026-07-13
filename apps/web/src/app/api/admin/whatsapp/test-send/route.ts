import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { generateOtp } from "@/lib/utils";
import { sendWhatsAppOtp, WhatsAppSendError } from "@/lib/whatsapp";

/**
 * Admin: send a real test OTP via WhatsApp and return Meta's response fields.
 * POST /api/admin/whatsapp/test-send  { "phone": "+9647..." }
 */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as { phone?: string };
  const phone = body.phone?.trim();
  if (!phone) {
    return json({ error: "phone required" }, 422);
  }

  const code = generateOtp(6);
  try {
    const result = await sendWhatsAppOtp(phone, code);
    return json({
      ok: true,
      note:
        result.messageStatus === "held_for_quality_assessment"
          ? "Meta HELD this message for template quality assessment — it may not reach WhatsApp yet."
          : "Meta accepted the request. If the phone gets nothing, check WhatsApp Manager → billing (payment method) and Insights for this wamid.",
      testCode: code,
      ...result,
      checks: [
        "WhatsApp Manager → Account tools → Phone numbers: messaging limit should not be empty",
        "WhatsApp Manager → Billing: payment method required (error 131042)",
        "Meta App must be Live",
        "Template otp/ar Quality pending can hold early messages",
        "Open WhatsApp Manager Insights and search the messageId",
      ],
    });
  } catch (e) {
    if (e instanceof WhatsAppSendError) {
      return json(
        {
          ok: false,
          error: e.message,
          code: e.code,
          details: e.details,
        },
        502
      );
    }
    throw e;
  }
}
