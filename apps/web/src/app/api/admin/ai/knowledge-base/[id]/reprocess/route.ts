import { error, json, requireAuth } from "@/lib/api";
import { KnowledgeBaseService } from "@/services/ai";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    await KnowledgeBaseService.reprocess(id);
    return json({ success: true });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Reprocess failed", 400, "REPROCESS");
  }
}
