import { error, json, requireAuth } from "@/lib/api";
import { ProfessorExamService } from "@/services/ai/professor";
import { z } from "zod";

const schema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(20),
  educationalStageId: z.string().optional(),
  subjectId: z.string().optional(),
  titleEn: z.string().max(200).optional(),
  count: z.number().int().min(3).max(20).optional(),
  language: z.string().max(16).optional(),
  courseId: z.string().optional(),
  lessonId: z.string().optional(),
  publish: z.boolean().optional(),
  versions: z.array(z.enum(["A", "B", "C"])).optional(),
  saveToBank: z.boolean().optional(),
  rich: z.boolean().optional(),
  questionTypes: z.array(z.string()).optional(),
  difficulty: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    if (parsed.data.rich) {
      const result = await ProfessorExamService.generateRich({
        instructorId: auth.session.userId,
        documentIds: parsed.data.documentIds,
        language: parsed.data.language,
        count: parsed.data.count,
        questionTypes: parsed.data.questionTypes,
        difficulty: parsed.data.difficulty,
        courseId: parsed.data.courseId,
      });
      return json(result, 201);
    }

    const result = await ProfessorExamService.generateAndPublish({
      instructorId: auth.session.userId,
      ...parsed.data,
    });
    return json(result, 202);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Exam generation failed", 500, "EXAM");
  }
}
