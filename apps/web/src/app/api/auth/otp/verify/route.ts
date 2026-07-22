import { AuthService } from "@/services/auth.service";
import { error, getClientIp, json, rateLimit } from "@/lib/api";
import { z } from "zod";

const schema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().min(4).max(8),
  deviceId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return error("Invalid input", 400, "VALIDATION_ERROR");
    }

    const ip = getClientIp(request) || "unknown";
    const limit = rateLimit(`otp-verify:${parsed.data.phone}:${ip}`, 10, 60_000);
    if (!limit.allowed) {
      return error("Too many requests", 429, "RATE_LIMITED");
    }

    const result = await AuthService.verifyOtp(parsed.data.phone, parsed.data.code, {
      deviceId: parsed.data.deviceId,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") || undefined,
    });

    if (!result.success) {
      return error(result.error, 400, result.error);
    }

    return json(result);
  } catch (e) {
    console.error(e);
    return error("Internal server error", 500);
  }
}
