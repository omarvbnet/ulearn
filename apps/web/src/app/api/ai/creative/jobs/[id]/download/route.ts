import { error, requireAuth } from "@/lib/api";
import { AiCreativeService } from "@/services/ai/creative";

const CREATIVE_ROLES = ["STUDENT", "CERTIFICATE_USER"] as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth([...CREATIVE_ROLES]);
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const job = await AiCreativeService.getJob(auth.session.userId, id);
  if (!job || job.status !== "SUCCEEDED" || !job.resultContent) {
    return error("Result not found", 404, "NOT_FOUND");
  }

  const bytes = Buffer.from(job.resultContent, "base64");
  const fileName = job.resultFileName || "creative-result.bin";
  const mime = job.resultMime || "application/octet-stream";

  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=60",
    },
  });
}
