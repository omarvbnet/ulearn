import { error, json, requireAuth } from "@/lib/api";
import { ProfessorGenerationService } from "@/services/ai/professor";
import { ProfessorGenerationType } from "@prisma/client";
import { z } from "zod";

export async function GET() {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const generations = await ProfessorGenerationService.list(auth.session.userId);
  return json({ generations });
}

const schema = z.object({
  type: z.nativeEnum(ProfessorGenerationType),
  title: z.string().min(1).max(200),
  language: z.string().optional(),
  parentId: z.string().optional(),
  params: z
    .object({
      subject: z.string().optional(),
      course: z.string().optional(),
      department: z.string().optional(),
      academicLevel: z.string().optional(),
      chapter: z.string().optional(),
      topic: z.string().optional(),
      pages: z.number().int().min(1).max(30).optional(),
      difficulty: z.string().optional(),
      learningStyle: z.string().optional(),
      extraPrompt: z.string().max(4000).optional(),
      courseId: z.string().optional(),
      documentIds: z.array(z.string()).optional(),
      exportFormats: z
        .array(z.enum(["markdown", "html", "pdf", "docx", "pptx"]))
        .optional(),
    })
    .default({}),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  try {
    const result = await ProfessorGenerationService.create({
      instructorId: auth.session.userId,
      ...parsed.data,
    });
    return json(result, 202);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Generation failed", 500);
  }
}
