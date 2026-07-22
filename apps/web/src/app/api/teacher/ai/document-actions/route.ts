import { error, json, requireAuth } from "@/lib/api";
import { ProfessorDocumentAiService } from "@/services/ai/professor";
import { z } from "zod";

export async function GET() {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  return json({ actions: ProfessorDocumentAiService.actions() });
}

const schema = z.object({
  documentId: z.string().min(1),
  action: z.string().min(1),
  language: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  try {
    const result = await ProfessorDocumentAiService.run({
      instructorId: auth.session.userId,
      documentId: parsed.data.documentId,
      action: parsed.data.action as never,
      language: parsed.data.language,
    });
    return json(result, 202);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Action failed", 400);
  }
}
