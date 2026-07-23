import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getUploadUrl, uploadExpiresIn } from "@/lib/r2";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";

export const WHITEBOARD_PLAYBACK_EXPIRES_SEC = Number(
  process.env.WHITEBOARD_PLAYBACK_EXPIRES_SEC || process.env.VIDEO_PLAYBACK_EXPIRES_SEC || 600
);

/** Max .ubrd package size (2 GB) — long lessons with audio + events. */
export const MAX_WHITEBOARD_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/octet-stream",
  "application/zip",
  "application/x-ubrd",
  "application/x-zip-compressed",
]);

const ALLOWED_EXT = new Set(["ubrd", "zip"]);

/** Single compressed lesson package path — no temp files. */
export function buildWhiteboardPackageKey(courseId: string, assetId: string) {
  return `whiteboards/${courseId}/${assetId}/lesson.ubrd`;
}

export function buildWhiteboardThumbnailKey(courseId: string, assetId: string) {
  return `whiteboards/${courseId}/${assetId}/thumb.jpg`;
}

export function validateWhiteboardPackage(params: {
  contentType: string;
  size: number;
  filename: string;
}): { valid: boolean; error?: string } {
  const ext = params.filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeOk = ALLOWED_MIME.has(params.contentType);
  const extOk = ALLOWED_EXT.has(ext);
  if (!mimeOk && !extOk) return { valid: false, error: "INVALID_FILE_TYPE" };
  if (params.size > MAX_WHITEBOARD_PACKAGE_BYTES) {
    return { valid: false, error: "FILE_TOO_LARGE" };
  }
  return { valid: true };
}

export async function getWhiteboardUploadUrl(params: {
  key: string;
  contentType: string;
  size: number;
  filename: string;
}) {
  const validation = validateWhiteboardPackage(params);
  if (!validation.valid) throw new Error(validation.error || "INVALID_FILE");

  const expiresIn = uploadExpiresIn("video", params.size);
  return getUploadUrl({
    key: params.key,
    contentType: params.contentType || "application/octet-stream",
    category: "video",
    size: params.size,
    expiresIn,
  });
}

export async function headWhiteboardObject(key: string) {
  const res = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return {
    size: Number(res.ContentLength ?? 0),
    contentType: res.ContentType ?? "application/octet-stream",
    etag: res.ETag?.replace(/"/g, ""),
  };
}
