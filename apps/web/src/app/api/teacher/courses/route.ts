import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isWhiteboardLessonsEnabled } from "@/lib/whiteboard-feature";
import { TeacherCourseService } from "@/services/teacher-course.service";
import { z } from "zod";

async function getTeacherProfile(userId: string) {
  return prisma.teacherProfile.findFirst({
    where: { userId, deletedAt: null },
    include: { subjects: { include: { subject: true } } },
  });
}

/** Teacher: list own courses with earnings summary. */
export async function GET() {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const profile = await getTeacherProfile(auth.session.userId);
  if (!profile) return error("Teacher profile not found", 404, "NOT_FOUND");

  const isCert = profile.teachingTrack === "CERTIFICATE";

  const [courses, earnings, stages, whiteboardLessonsEnabled] = await Promise.all([
    TeacherCourseService.listTeacherCourses(profile.id),
    TeacherCourseService.teacherEarnings(profile.id),
    prisma.educationalStage.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        isCertificateTrack: isCert,
        ...(profile.countryId ? { countryId: profile.countryId } : {}),
      },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        nameKu: true,
        nameTr: true,
        isCertificateTrack: true,
      },
    }),
    isWhiteboardLessonsEnabled(),
  ]);

  return json({
    courses,
    earnings,
    level: profile.level,
    isActive: profile.isActive,
    teachingTrack: profile.teachingTrack,
    subjects: profile.subjects.map((s) => s.subject),
    stages,
    features: {
      whiteboardLessonsEnabled,
    },
  });
}

const createSchema = z.object({
  stageId: z.string(),
  subjectId: z.string(),
  titleEn: z.string().min(2),
  titleAr: z.string().optional(),
  titleKu: z.string().optional(),
  titleTr: z.string().optional(),
  description: z.string().optional(),
  thumbnail: z.string().optional(),
  price: z.number().min(0),
  currency: z.string().optional(),
  accessMonths: z.number().int().min(1).max(120).optional(),
});

/** Teacher: create a course (goes to admin review before publishing). */
export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"], { requireApproved: true });
  if (auth.error) return auth.error;

  const profile = await getTeacherProfile(auth.session.userId);
  if (!profile) return error("Teacher profile not found", 404, "NOT_FOUND");
  if (profile.subjects.length === 0) {
    return error(
      profile.teachingTrack === "CERTIFICATE"
        ? "Set your teaching insights on your profile first"
        : "Set your teaching specialties on your profile first",
      400,
      "NO_SPECIALTIES_SET"
    );
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const result = await TeacherCourseService.createCourse(profile.id, parsed.data);
  if (!result.success) return error(result.error, 400, result.error);

  return json({ course: result.course }, 201);
}
