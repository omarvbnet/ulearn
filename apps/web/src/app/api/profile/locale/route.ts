import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { Locale } from "@prisma/client";
import { z } from "zod";

const patchSchema = z.object({
  locale: z.nativeEnum(Locale),
});

/** Update the signed-in user's display language preference. */
export async function PATCH(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const user = await prisma.user.update({
    where: { id: auth.session.userId },
    data: { locale: parsed.data.locale },
    include: {
      studentProfile: {
        include: {
          educationalStage: {
            select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
          },
        },
      },
      certificateProfile: true,
      teacherProfile: { include: { subjects: true } },
    },
  });

  return json({ user });
}
