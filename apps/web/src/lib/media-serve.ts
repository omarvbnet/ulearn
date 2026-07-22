import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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

function isHeavyMedia(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.startsWith("teacher-shorts/") ||
    lower.startsWith("teacher-courses/") ||
    lower.startsWith("videos/") ||
    lower.startsWith("lessons/") ||
    lower.startsWith("intro-outro/") ||
    /\.(mp4|webm|mov|mkv|avi|m4v|mpg|mpeg|3gp)$/i.test(key)
  );
}

function isImageKey(key: string): boolean {
  return (
    /\.(jpe?g|png|webp|gif|avif|heic|bmp)$/i.test(key) ||
    key.startsWith("profile-photos/") ||
    key.startsWith("ads/") ||
    key.startsWith("teacher-covers/") ||
    key.startsWith("teacher-shorts-covers/")
  );
}

/** Proxy a signed R2 URL through this origin (no client-side 302). */
async function proxySignedObject(key: string): Promise<Response> {
  const signed = await getDownloadUrl(key, 60 * 60);
  const upstream = await fetch(signed);
  if (!upstream.ok || !upstream.body) {
    return error("Media not found", 404, "NOT_FOUND");
  }
  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("Content-Type") || guessContentType(key)
  );
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  const len = upstream.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}

/**
 * Serve video/PDF via credentialed R2.
 *
 * iOS AVPlayer sends HEAD first (must succeed here), then GET/Range.
 * We answer HEAD with HeadObject metadata, then 302 GET/Range to a signed
 * R2 URL. Proxying multi‑hundred‑MB lessons through Vercel causes
 * "Could not play this video" on TestFlight.
 */
async function serveHeavyMedia(safeKey: string, request: Request): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === "HEAD") {
    try {
      const head = await r2Client.send(
        new HeadObjectCommand({ Bucket: r2Bucket, Key: safeKey })
      );
      const headers = new Headers();
      headers.set("Content-Type", head.ContentType || guessContentType(safeKey));
      headers.set("Accept-Ranges", "bytes");
      // Do not cache HEAD across CDN — length/etag must stay fresh per object.
      headers.set("Cache-Control", "private, no-store");
      if (head.ContentLength != null) {
        headers.set("Content-Length", String(head.ContentLength));
      }
      if (head.ETag) headers.set("ETag", head.ETag);
      return new Response(null, { status: 200, headers });
    } catch {
      return error("Media not found", 404, "NOT_FOUND");
    }
  }

  // GET or Range: redirect to SigV4 URL (player follows redirect + Range on R2).
  try {
    const signed = await getDownloadUrl(safeKey, 60 * 60 * 6);
    const headers = new Headers({
      Location: signed,
      "Cache-Control": "private, no-store",
    });
    return new Response(null, { status: 302, headers });
  } catch {
    return error("Media not found", 404, "NOT_FOUND");
  }
}

/**
 * Stream (or redirect) an R2 object by key.
 *
 * Images always stay same-origin (stream or proxy) — Flutter's image cache
 * often fails on cross-host 302 redirects to R2 signed URLs.
 * Videos stay same-origin too so iOS AVPlayer HEAD probes succeed.
 */
export async function serveR2Object(key: string, request: Request): Promise<Response> {
  const safeKey = key.trim().replace(/^\/+/, "");
  if (!safeKey || safeKey.includes("..")) {
    return error("Invalid key", 422, "VALIDATION");
  }

  if (!isR2Configured()) {
    return Response.redirect(new URL(`/uploads/${safeKey}`, request.url), 302);
  }

  const heavy = isHeavyMedia(safeKey);
  const image = isImageKey(safeKey);

  if (heavy && !image) {
    return serveHeavyMedia(safeKey, request);
  }

  try {
    const obj = await r2Client.send(
      new GetObjectCommand({ Bucket: r2Bucket, Key: safeKey })
    );
    if (!obj.Body) {
      if (image) return error("Media not found", 404, "NOT_FOUND");
      return proxySignedObject(safeKey);
    }

    const headers = new Headers();
    headers.set("Content-Type", obj.ContentType || guessContentType(safeKey));
    headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    if (obj.ContentLength != null) headers.set("Content-Length", String(obj.ContentLength));
    if (obj.ETag) headers.set("ETag", obj.ETag);

    return new Response(toWebStream(obj.Body), { status: 200, headers });
  } catch {
    // Never 302 images to R2 — Flutter DecorationImage / cache managers break on it.
    if (image) {
      try {
        return await proxySignedObject(safeKey);
      } catch {
        return error("Media not found", 404, "NOT_FOUND");
      }
    }
    try {
      const signed = await getDownloadUrl(safeKey, 60 * 60);
      return Response.redirect(signed, 302);
    } catch {
      return error("Media not found", 404, "NOT_FOUND");
    }
  }
}
