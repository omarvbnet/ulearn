import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveTeacherVoice } from "@/services/ai/voice-accent";
import { z } from "zod";

const schema = z.object({
  language: z.string().max(16).optional(),
});

/**
 * Returns the AI Teacher voice/accent profile for this student
 * (selected language + registered country).
 */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const languageParam = url.searchParams.get("language") || undefined;

  const profile = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: {
      locale: true,
      country: { select: { code: true, nameEn: true } },
    },
  });

  const resolved = resolveTeacherVoice({
    language: languageParam || profile?.locale || "en",
    countryCode: profile?.country?.code || null,
  });

  return json({
    ...resolved,
    countryName: profile?.country?.nameEn || null,
    profileLocale: profile?.locale || null,
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const body = schema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return error("Invalid input", 422, "VALIDATION");

  const profile = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: {
      locale: true,
      country: { select: { code: true, nameEn: true } },
    },
  });

  const resolved = resolveTeacherVoice({
    language: body.data.language || profile?.locale || "en",
    countryCode: profile?.country?.code || null,
  });

  return json({
    ...resolved,
    countryName: profile?.country?.nameEn || null,
    profileLocale: profile?.locale || null,
  });
}
