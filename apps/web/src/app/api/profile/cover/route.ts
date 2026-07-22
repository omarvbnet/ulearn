import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const PRESET_COUNT = 12;

const patchSchema = z.object({
  preset: z.number().int().min(0).max(PRESET_COUNT - 1).nullable(),
});

/** Teachers: choose a profile banner preset (0–11). */
export async function PATCH(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const user = await prisma.user.update({
    where: { id: auth.session.userId },
    data: { profileCoverPreset: parsed.data.preset },
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
