import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { Locale } from "@prisma/client";

/** Admin: list intro/outro clips. */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const clips = await prisma.introOutro.findMany({
    orderBy: [{ type: "asc" }, { locale: "asc" }],
    include: { country: { select: { nameEn: true, code: true } } },
  });

  return json({ clips });
}

/** Admin: create or replace an intro/outro clip for a locale (+optional country). */
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { countryId, locale, type, fileKey, fileUrl } = (await request.json()) as {
    countryId?: string | null;
    locale?: Locale;
    type?: "INTRO" | "OUTRO";
    fileKey?: string;
    fileUrl?: string;
  };

  if (!locale || !type || !fileKey) {
    return error("locale, type, and fileKey are required", 422, "VALIDATION");
  }

  // countryId is nullable in the compound unique, so upsert manually.
  const existing = await prisma.introOutro.findFirst({
    where: { countryId: countryId ?? null, locale, type },
  });

  const clip = existing
    ? await prisma.introOutro.update({
        where: { id: existing.id },
        data: { fileKey, fileUrl: fileUrl || null, isActive: true },
      })
    : await prisma.introOutro.create({
        data: { countryId: countryId ?? null, locale, type, fileKey, fileUrl: fileUrl || null },
      });

  return json({ clip }, existing ? 200 : 201);
}
