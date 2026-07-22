import { json, requireAuth } from "@/lib/api";
import { AiChatService } from "@/services/ai";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const conversations = await AiChatService.listConversations(auth.session.userId);
  return json({ conversations });
}
