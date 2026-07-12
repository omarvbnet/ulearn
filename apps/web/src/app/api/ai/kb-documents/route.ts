import { error, json, requireAuth } from "@/lib/api";
import { AiExamService } from "@/services/ai";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  try {
    const [documents, meta] = await Promise.all([
      AiExamService.listKbDocumentsForUser(auth.session.userId),
      AiExamService.listKbDocumentsMeta(auth.session.userId),
    ]);
    return json({ documents, meta });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Failed to list documents", 500);
  }
}
