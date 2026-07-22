import { error, json, requireAuth } from "@/lib/api";
import { createWriteStream } from "fs";
import { mkdir, stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const runtime = "nodejs";

const PROFILE_ROLES = ["STUDENT", "CERTIFICATE_USER", "TEACHER"] as const;

/** Dev fallback: store profile photo under public/uploads/profile-photos/{userId}/ */
export async function PUT(request: Request) {
  const auth = await requireAuth([...PROFILE_ROLES]);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return error("key is required", 422, "VALIDATION");

  const prefix = `profile-photos/${auth.session.userId}/`;
  if (!key.startsWith(prefix)) {
    return error("Invalid key", 403, "FORBIDDEN");
  }

  const safeKey = path.normalize(key).replace(/^(\.\.[/\\])+/, "");
  if (safeKey.includes("..")) return error("Invalid key", 422, "VALIDATION");

  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  const target = path.join(uploadsRoot, safeKey);
  if (!target.startsWith(uploadsRoot)) return error("Invalid key", 422, "VALIDATION");

  if (!request.body) return error("Empty body", 422, "VALIDATION");

  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(
    Readable.fromWeb(request.body as import("stream/web").ReadableStream),
    createWriteStream(target)
  );

  const { size } = await stat(target);
  if (size === 0) return error("Empty body", 422, "VALIDATION");

  return json({ ok: true, key: safeKey, size, url: `/uploads/${safeKey}` });
}
