import { error, json, requireAuth } from "@/lib/api";
import { STAFF_ROLES } from "@/lib/auth/session";
import { createWriteStream } from "fs";
import { mkdir, stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const runtime = "nodejs";

/**
 * Development fallback upload target when R2 is not configured.
 * Accepts a raw PUT body and stores it under public/uploads/<key>.
 */
export async function PUT(request: Request) {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return error("key is required", 422, "VALIDATION");

  // Prevent path traversal outside the uploads directory.
  const safeKey = path.normalize(key).replace(/^(\.\.[/\\])+/, "");
  if (safeKey.includes("..")) return error("Invalid key", 422, "VALIDATION");

  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  const target = path.join(uploadsRoot, safeKey);
  if (!target.startsWith(uploadsRoot)) return error("Invalid key", 422, "VALIDATION");

  if (!request.body) return error("Empty body", 422, "VALIDATION");

  await mkdir(path.dirname(target), { recursive: true });

  // Stream to disk so multi-GB videos don't get buffered in memory.
  await pipeline(
    Readable.fromWeb(request.body as import("stream/web").ReadableStream),
    createWriteStream(target)
  );

  const { size } = await stat(target);
  if (size === 0) return error("Empty body", 422, "VALIDATION");

  return json({ ok: true, key: safeKey, size, url: `/uploads/${safeKey}` });
}
