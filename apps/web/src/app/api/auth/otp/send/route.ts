import { AuthService } from "@/services/auth.service";
import { error, getClientIp, json, rateLimit } from "@/lib/api";
import { z } from "zod";

const schema = z.object({
  phone: z.string().min(8).max(20),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return error("Invalid phone number", 400, "VALIDATION_ERROR");
    }

    const ip = getClientIp(request) || "unknown";
    const limit = rateLimit(`otp:${parsed.data.phone}:${ip}`, 5, 60_000);
    if (!limit.allowed) {
      return error("Too many requests", 429, "RATE_LIMITED");
    }

    const result = await AuthService.sendOtp(parsed.data.phone);
    return json(result);
  } catch (e) {
    console.error(e);
    const { WhatsAppSendError } = await import("@/lib/whatsapp");
    if (e instanceof WhatsAppSendError) {
      return error(e.message, 502, e.code, {
        details: process.env.NODE_ENV === "production" ? undefined : e.details,
      });
    }
    return error("Internal server error", 500);
  }
}
