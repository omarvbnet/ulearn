import { json } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Public: WhatsApp support contact configured by admin (SystemSetting).
 * GET /api/support/contact → { phone, whatsappUrl } | { phone: null }
 */
export async function GET() {
  const row = await prisma.systemSetting.findFirst({
    where: { key: "support_whatsapp_phone", countryId: null },
  });

  const raw =
    row?.value == null
      ? ""
      : typeof row.value === "string"
        ? row.value
        : typeof row.value === "object" &&
            row.value !== null &&
            "phone" in (row.value as object)
          ? String((row.value as { phone?: unknown }).phone ?? "")
          : String(row.value);

  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return json({ phone: null, whatsappUrl: null });
  }

  // wa.me expects country code without + (e.g. 964770…).
  const phone = digits.startsWith("00") ? digits.slice(2) : digits;
  return json({
    phone: `+${phone}`,
    whatsappUrl: `https://wa.me/${phone}`,
  });
}
