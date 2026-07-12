import { error, json, requireAuth } from "@/lib/api";
import { ProfessorDocumentService } from "@/services/ai/professor";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const document = await ProfessorDocumentService.get(auth.session.userId, id);
  if (!document) return error("Not found", 404, "NOT_FOUND");
  return json({ document });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  try {
    await ProfessorDocumentService.remove(auth.session.userId, id);
    return json({ ok: true });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Delete failed", 400);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === "reprocess") {
    try {
      await ProfessorDocumentService.reprocess(auth.session.userId, id);
      return json({ ok: true });
    } catch (e) {
      return error(e instanceof Error ? e.message : "Reprocess failed", 400);
    }
  }
  return error("Unknown action", 400);
}
