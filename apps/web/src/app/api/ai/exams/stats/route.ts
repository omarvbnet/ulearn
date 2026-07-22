import { error, json, requireAuth } from "@/lib/api";
import { AiExamService } from "@/services/ai";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  try {
    const stats = await AiExamService.getStats(auth.session.userId);
    return json({ stats });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Stats failed", 500);
  }
}
