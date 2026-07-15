import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  MAX_TEACHER_INSIGHTS,
  MAX_TEACHER_SPECIALTIES,
  TeacherProfileService,
} from "@/services/teacher-profile.service";
import { z } from "zod";

/** Teacher: read profile specialties/insights, catalog, and stages for course creation. */
export async function GET() {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const ctx = await TeacherProfileService.getTeacherContext(auth.session.userId);
  if (!ctx) return error("Teacher profile not found", 404, "NOT_FOUND");

  const max =
    ctx.teachingTrack === "CERTIFICATE"
      ? MAX_TEACHER_INSIGHTS
      : MAX_TEACHER_SPECIALTIES;

  return json({
    teachingTrack: ctx.teachingTrack,
    specialties: ctx.specialties,
    insights: ctx.insights,
    available: ctx.available,
    stages: ctx.stages,
    maxSpecialties: max,
  });
}

/** Teacher: update assigned specialties (school) or insights (certificate track). */
export async function PATCH(request: Request) {
  const auth = await requireAuth(["TEACHER"], { requireApproved: true });
  if (auth.error) return auth.error;

  const profile = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
  });
  if (!profile) return error("Teacher profile not found", 404, "NOT_FOUND");

  const max =
    profile.teachingTrack === "CERTIFICATE"
      ? MAX_TEACHER_INSIGHTS
      : MAX_TEACHER_SPECIALTIES;

  const patchSchema = z.object({
    subjectIds: z.array(z.string()).min(1).max(max),
  });

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await TeacherProfileService.updateSpecialties(
    profile.id,
    parsed.data.subjectIds
  );
  if (!result.success) {
    const label =
      profile.teachingTrack === "CERTIFICATE" ? "insights" : "specialties";
    const msg =
      result.error === "INVALID_SPECIALTY_COUNT"
        ? `Select 1 to ${max} ${label}`
        : result.error === "INVALID_SUBJECT"
          ? `One or more ${label} are not available`
          : "Update failed";
    return error(msg, 400, result.error);
  }

  return json({
    teachingTrack: profile.teachingTrack,
    specialties: result.subjects.map((s) => ({
      id: s.id,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      nameKu: s.nameKu,
      nameTr: s.nameTr,
    })),
  });
}
