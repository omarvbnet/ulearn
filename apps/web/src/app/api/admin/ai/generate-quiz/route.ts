import { error, json, requireAuth } from "@/lib/api";
import { ExamGeneratorService } from "@/services/ai";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  educationalStageId: z.string().min(1),
  subjectId: z.string().optional(),
  documentIds: z.array(z.string().min(1)).min(1).max(20),
  titleEn: z.string().max(200).optional(),
  count: z.number().int().min(3).max(20).optional(),
  language: z.string().max(16).optional(),
  courseId: z.string().optional(),
  lessonId: z.string().optional(),
  /** When false, return preview only. Default true. */
  publish: z.boolean().optional().default(true),
});

/** SUPER_ADMIN / COUNTRY_ADMIN / TEACHER: generate quiz from KB materials. */
export async function POST(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN", "TEACHER"]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return error("Invalid input — stage and materials required", 422, "VALIDATION");
  }

  const docs = await prisma.kbDocument.findMany({
    where: {
      id: { in: parsed.data.documentIds },
      deletedAt: null,
      status: "READY",
    },
    select: { id: true, educationalStageId: true },
  });
  if (docs.length !== parsed.data.documentIds.length) {
    return error("Some documents are missing or not READY", 422, "DOCS");
  }

  try {
    const result = await ExamGeneratorService.generateAndPublish({
      actorId: auth.session.userId,
      educationalStageId: parsed.data.educationalStageId,
      subjectId: parsed.data.subjectId,
      documentIds: parsed.data.documentIds,
      titleEn: parsed.data.titleEn,
      count: parsed.data.count,
      language: parsed.data.language,
      courseId: parsed.data.courseId,
      lessonId: parsed.data.lessonId,
      publish: parsed.data.publish,
    });
    return json(result, result.quiz ? 201 : 200);
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Quiz generation failed",
      500,
      "EXAM_GEN"
    );
  }
}
