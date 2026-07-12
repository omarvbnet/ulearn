import { error, json, requireAuth } from "@/lib/api";
import { ProfessorExamService, ProfessorQuestionBankService } from "@/services/ai/professor";
import { z } from "zod";

export async function GET(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("export") === "1") {
    const ids = searchParams.get("ids")?.split(",").filter(Boolean);
    const items = await ProfessorQuestionBankService.exportJson(auth.session.userId, ids);
    return json({ items });
  }
  const items = await ProfessorQuestionBankService.list(auth.session.userId, {
    q: searchParams.get("q") || undefined,
    subject: searchParams.get("subject") || undefined,
    chapter: searchParams.get("chapter") || undefined,
    difficulty: searchParams.get("difficulty") || undefined,
    questionType: searchParams.get("questionType") || undefined,
    courseId: searchParams.get("courseId") || undefined,
  });
  return json({ items });
}

const createSchema = z.object({
  subject: z.string().optional(),
  chapter: z.string().optional(),
  lesson: z.string().optional(),
  topic: z.string().optional(),
  difficulty: z.string().optional(),
  bloom: z.string().optional(),
  questionType: z.string().min(1),
  language: z.string().optional(),
  text: z.string().min(1),
  options: z.record(z.string(), z.string()).optional(),
  correctKey: z.string().optional(),
  answerKey: z.string().optional(),
  marks: z.number().optional(),
  timeEstimateSec: z.number().int().optional(),
  courseId: z.string().optional(),
  documentId: z.string().optional(),
  examVersion: z.string().optional(),
});

const gradeSchema = z.object({
  action: z.literal("grade"),
  questionText: z.string().min(1),
  studentAnswer: z.string().min(1),
  rubric: z.string().optional(),
  maxMarks: z.number().optional(),
  language: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const body = await request.json();
  if (body?.action === "grade") {
    const parsed = gradeSchema.safeParse(body);
    if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
    const result = await ProfessorExamService.gradeEssay({
      instructorId: auth.session.userId,
      ...parsed.data,
    });
    return json(result, 202);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  const item = await ProfessorQuestionBankService.create(auth.session.userId, parsed.data);
  return json({ item }, 201);
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return error("id required", 422);
  try {
    await ProfessorQuestionBankService.remove(auth.session.userId, id);
    return json({ ok: true });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Delete failed", 400);
  }
}
