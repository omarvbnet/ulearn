import { error, json, requireAuth } from "@/lib/api";
import { ProfessorJobService } from "@/services/ai/professor";

export async function GET(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (id) {
    const job = await ProfessorJobService.get(auth.session.userId, id);
    if (!job) return error("Not found", 404, "NOT_FOUND");
    return json({ job });
  }
  const jobs = await ProfessorJobService.list(auth.session.userId);
  return json({ jobs });
}
