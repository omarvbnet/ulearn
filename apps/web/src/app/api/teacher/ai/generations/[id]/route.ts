import { error, json, requireAuth } from "@/lib/api";
import { ProfessorExportService, ProfessorGenerationService } from "@/services/ai/professor";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const artifactId = searchParams.get("artifactId");

  if (artifactId) {
    const artifact = await ProfessorExportService.getArtifact(auth.session.userId, artifactId);
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
    return new Response(artifact.contentText || "", {
      headers: {
        "Content-Type": ProfessorExportService.kindMime(artifact.kind),
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
      },
    });
  }

  const generation = await ProfessorGenerationService.get(auth.session.userId, id);
  if (!generation) return error("Not found", 404);
  return json({ generation });
}
