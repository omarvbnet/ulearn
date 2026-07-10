import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { error } from "@/lib/api";
import { getDownloadUrl, isR2Configured, r2Bucket, r2Client } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guessContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function toWebStream(body: unknown): ReadableStream {
  if (
    body &&
    typeof (body as { transformToWebStream?: () => ReadableStream }).transformToWebStream ===
      "function"
  ) {
    return (body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as unknown as ReadableStream;
  }
  return body as ReadableStream;
}

/**
 * Stream (or redirect) an R2 object by key.
 * Images/PDFs stream through the API using R2 credentials so Flutter/admin
 * do not depend on a public CDN. Large videos redirect to a signed URL.
 */
export async function serveR2Object(key: string, request: Request): Promise<Response> {
  const safeKey = key.trim().replace(/^\/+/, "");
  if (!safeKey || safeKey.includes("..")) {
    return error("Invalid key", 422, "VALIDATION");
  }

  if (!isR2Configured()) {
    return Response.redirect(new URL(`/uploads/${safeKey}`, request.url), 302);
  }

  const lower = safeKey.toLowerCase();
  const isHeavy =
    lower.startsWith("teacher-shorts/") ||
    lower.startsWith("teacher-courses/") ||
    lower.startsWith("videos/") ||
    lower.startsWith("lessons/") ||
    /\.(mp4|webm|mov|mkv|avi|m4v|mpg|mpeg|3gp)$/i.test(safeKey);

  if (isHeavy) {
    try {
      const signed = await getDownloadUrl(safeKey, 60 * 60 * 6);
      return Response.redirect(signed, 302);
    } catch {
      return error("Media not found", 404, "NOT_FOUND");
    }
  }

  try {
    const obj = await r2Client.send(
      new GetObjectCommand({ Bucket: r2Bucket, Key: safeKey })
    );
    if (!obj.Body) return error("Media not found", 404, "NOT_FOUND");

    const headers = new Headers();
    headers.set("Content-Type", obj.ContentType || guessContentType(safeKey));
    headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    if (obj.ContentLength != null) headers.set("Content-Length", String(obj.ContentLength));
    if (obj.ETag) headers.set("ETag", obj.ETag);

    return new Response(toWebStream(obj.Body), { status: 200, headers });
  } catch {
    try {
      const signed = await getDownloadUrl(safeKey, 60 * 60);
      return Response.redirect(signed, 302);
    } catch {
      return error("Media not found", 404, "NOT_FOUND");
    }
  }
}
