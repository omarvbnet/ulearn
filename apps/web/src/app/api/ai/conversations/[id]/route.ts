import { error, json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await params;
  const conversation = await AiChatService.getConversation(auth.session.userId, id);
  if (!conversation) return error("Not found", 404, "NOT_FOUND");
  return json({ conversation });
}
