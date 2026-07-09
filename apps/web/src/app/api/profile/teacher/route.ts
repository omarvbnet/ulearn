import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  MAX_TEACHER_SPECIALTIES,
  TeacherProfileService,
} from "@/services/teacher-profile.service";
import { z } from "zod";

const patchSchema = z.object({
  subjectIds: z.array(z.string()).min(1).max(MAX_TEACHER_SPECIALTIES),
});

/** Teacher: read profile specialties, catalog, and stages for course creation. */
export async function GET() {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const ctx = await TeacherProfileService.getTeacherContext(auth.session.userId);
  if (!ctx) return error("Teacher profile not found", 404, "NOT_FOUND");

  return json({
    specialties: ctx.specialties,
    available: ctx.available,
    stages: ctx.stages,
    maxSpecialties: MAX_TEACHER_SPECIALTIES,
  });
}

/** Teacher: set up to 3 teaching specialties on their profile. */
export async function PATCH(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const profile = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
  });
  if (!profile) return error("Teacher profile not found", 404, "NOT_FOUND");

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await TeacherProfileService.updateSpecialties(
    profile.id,
    parsed.data.subjectIds
  );
  if (!result.success) {
    const msg =
      result.error === "INVALID_SPECIALTY_COUNT"
        ? `Select 1 to ${MAX_TEACHER_SPECIALTIES} specialties`
        : result.error === "INVALID_SUBJECT"
          ? "One or more specialties are not available"
          : "Update failed";
    return error(msg, 400, result.error);
  }

  return json({
    specialties: result.subjects.map((s) => ({
      id: s.id,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      nameKu: s.nameKu,
      nameTr: s.nameTr,
    })),
  });
}
