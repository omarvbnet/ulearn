import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";

const r2 = r2Client;
const BUCKET = R2_BUCKET;
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

const ALLOWED_MIME: Record<string, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: [
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/x-msvideo",
    "video/mpeg",
    "video/3gpp",
  ],
  document: [
    "application/pdf",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ],
};

// Browsers report an empty or vendor-specific MIME type for some files,
// so we also accept files by extension.
const ALLOWED_EXT: Record<string, string[]> = {
  image: ["jpg", "jpeg", "png", "webp", "gif"],
  video: ["mp4", "webm", "mov", "mkv", "avi", "m4v", "mpg", "mpeg", "3gp"],
  document: ["pdf", "zip", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt"],
};

export const MAX_SIZES: Record<string, number> = {
  image: 20 * 1024 * 1024, // 20 MB
  video: 6 * 1024 * 1024 * 1024, // 6 GB
  document: 200 * 1024 * 1024, // 200 MB
};

export function maxSizeLabel(category: string): string {
  const bytes = MAX_SIZES[category] ?? 0;
  return bytes >= 1024 ** 3 ? `${bytes / 1024 ** 3} GB` : `${bytes / 1024 ** 2} MB`;
}

export function validateFile(
  mimeType: string,
  size: number,
  category: "image" | "video" | "document",
  filename?: string
): { valid: boolean; error?: string } {
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  const mimeOk = Boolean(mimeType) && ALLOWED_MIME[category].includes(mimeType);
  const extOk = ALLOWED_EXT[category].includes(ext);
  if (!mimeOk && !extOk) {
    return { valid: false, error: "INVALID_FILE_TYPE" };
  }
  if (size > MAX_SIZES[category]) {
    return { valid: false, error: "FILE_TOO_LARGE" };
  }
  return { valid: true };
}

export function uploadExpiresIn(category: string, size: number): number {
  if (category === "video") {
    // At least 2 hours; +1 hour per GB, capped at 24 hours.
    const hours = Math.min(24, Math.max(2, Math.ceil(size / 1024 ** 3) + 2));
    return hours * 3600;
  }
  if (category === "document" && size > 50 * 1024 * 1024) {
    return 7200;
  }
  return 3600;
}

export async function getUploadUrl(params: {
  key: string;
  contentType: string;
  expiresIn?: number;
  category?: string;
  size?: number;
}) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: params.key,
    ContentType: params.contentType,
  });

  const expiresIn =
    params.expiresIn ??
    (params.category && params.size != null
      ? uploadExpiresIn(params.category, params.size)
      : 3600);

  const url = await getSignedUrl(r2, command, {
    expiresIn,
  });

  return {
    uploadUrl: url,
    key: params.key,
    publicUrl: PUBLIC_URL ? `${PUBLIC_URL}/${params.key}` : undefined,
    expiresIn,
  };
}

export async function getDownloadUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn });
}

/**
 * Resolve a stable client-facing media URL from a stored public URL and/or object key.
 * Prefers https public CDN, then stored relative/absolute URLs, then a fresh signed URL.
 */
export async function resolvePublicMediaUrl(
  url?: string | null,
  key?: string | null
): Promise<string | null> {
  const trimmed = url?.trim() || "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (key && PUBLIC_URL) return `${PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  if (trimmed.startsWith("/")) return trimmed;
  if (key) {
    try {
      return await getDownloadUrl(key, 60 * 60 * 12);
    } catch {
      return `/uploads/${key}`;
    }
  }
  if (trimmed) return trimmed;
  return null;
}

export async function deleteObject(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function downloadObjectToFile(key: string, destPath: string) {
  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!response.Body) throw new Error("EMPTY_OBJECT");
  await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destPath));
}

export async function uploadFileFromPath(
  key: string,
  filePath: string,
  contentType: string
) {
  const { createReadStream } = await import("fs");
  const { stat } = await import("fs/promises");
  const size = (await stat(filePath)).size;
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
    })
  );
}

export function buildKey(folder: string, filename: string, userId?: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const prefix = userId ? `${folder}/${userId}` : folder;
  return `${prefix}/${Date.now()}-${safe}`;
}
