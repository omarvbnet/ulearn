import { error, json, requireAuth } from "@/lib/api";
import { ProfessorPdfToolsService } from "@/services/ai/professor";
import { z } from "zod";

const schema = z.object({
  tool: z.enum([
    "MERGE",
    "SPLIT",
    "ROTATE",
    "WATERMARK",
    "PROTECT",
    "COMPRESS",
    "EXTRACT_TEXT",
    "COMPARE",
    "CONVERT_DOCX",
    "CONVERT_PPTX",
  ]),
  documentIds: z.array(z.string()).min(1).max(20),
  options: z
    .object({
      pages: z.array(z.number().int().positive()).optional(),
      rotateDegrees: z.number().optional(),
      watermarkText: z.string().max(80).optional(),
      password: z.string().max(64).optional(),
      compareWithDocumentId: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");
  try {
    const result = await ProfessorPdfToolsService.run({
      instructorId: auth.session.userId,
      ...parsed.data,
    });
    return json(result, 202);
  } catch (e) {
    return error(e instanceof Error ? e.message : "PDF tool failed", 400);
  }
}
