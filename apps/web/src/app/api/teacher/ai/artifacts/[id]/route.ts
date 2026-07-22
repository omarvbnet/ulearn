import { error, requireAuth } from "@/lib/api";
import { ProfessorExportService } from "@/services/ai/professor";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const artifact = await ProfessorExportService.getArtifact(auth.session.userId, id);
  if (!artifact) return error("Not found", 404);
  const encoding = (artifact.meta as { encoding?: string } | null)?.encoding;
  if (encoding === "base64" && artifact.contentText) {
    const buf = Buffer.from(artifact.contentText, "base64");
    return new Response(buf, {
      headers: {
        "Content-Type": ProfessorExportService.kindMime(artifact.kind),
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
      },
    });
  }
  if (artifact.kind === "JSON" || artifact.kind === "FLASHCARDS" || artifact.kind === "MIND_MAP") {
    return Response.json({
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        fileName: artifact.fileName,
        content: artifact.contentText ? JSON.parse(artifact.contentText) : null,
        meta: artifact.meta,
      },
    });
  }
  return new Response(artifact.contentText || "", {
    headers: {
      "Content-Type": ProfessorExportService.kindMime(artifact.kind),
      "Content-Disposition": `inline; filename="${artifact.fileName}"`,
    },
  });
}
