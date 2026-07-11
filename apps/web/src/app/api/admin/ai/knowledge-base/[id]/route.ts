import { error, json, requireAuth } from "@/lib/api";
import { KnowledgeBaseService } from "@/services/ai";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  const document = await KnowledgeBaseService.get(id);
  if (!document) return error("Not found", 404, "NOT_FOUND");
  return json({ document });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  await KnowledgeBaseService.softDelete(id);
  return json({ success: true });
}
