import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";

export { r2Client };
export const r2Bucket = R2_BUCKET;

const r2 = r2Client;
const BUCKET = R2_BUCKET;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

export function isR2Configured() {
  return Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);
}

/** R2 object key prefixes used by this app (must match bucket folders). */
export const R2_KEY_PREFIXES = [
  "ads/",
  "diagnostics/",
  "intro-outro/",
  "lessons/",
  "profile-photos/",
  "stage-certificates/",
  "teacher-course-pdfs/",
  "teacher-courses/",
  "teacher-covers/",
  "teacher-shorts-covers/",
  "teacher-shorts/",
  "professor-docs/",
  "professor-artifacts/",
  "ai-creative/",
  "videos/",
] as const;

const ALLOWED_MIME: Record<string, string[]> = {
  image: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
  ],
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
  image: ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"],
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

/** Default playback signature lifetime (6h) — long enough for a study session. */
export const PLAYBACK_URL_EXPIRES_SEC = 60 * 60 * 6;

function forceHttpsUrl(url: string): string {
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  return url;
}

export async function getDownloadUrl(
  key: string,
  expiresIn = PLAYBACK_URL_EXPIRES_SEC
) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  // Keep signed headers minimal so mobile players can Range-request freely.
  const url = await getSignedUrl(r2, command, {
    expiresIn,
    unhoistableHeaders: new Set(["x-amz-checksum-mode"]),
  });
  return forceHttpsUrl(url);
}

/**
 * Fresh signed HTTPS playback URL for lessons / shorts.
 * Always resigns from fileKey (or a key recovered from fileUrl). Never returns a
 * stale DB absolute URL that still has X-Amz-* query params.
 */
export async function resolvePlaybackUrl(
  fileKey?: string | null,
  fileUrl?: string | null,
  expiresIn = PLAYBACK_URL_EXPIRES_SEC
): Promise<string | null> {
  const key = extractStorageKey(fileUrl, fileKey);
  if (key && isR2Configured()) {
    try {
      return await getDownloadUrl(key, expiresIn);
    } catch {
      return mediaProxyPath(key);
    }
  }

  const trimmed = fileUrl?.trim() || "";
  if (!trimmed) return null;

  // Stored absolute signed URLs expire — do not hand them to mobile players.
  if (/[?&]X-Amz-/i.test(trimmed)) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return forceHttpsUrl(trimmed);
  }
  if (trimmed.startsWith("/")) return trimmed;
  return trimmed;
}

/** Same-origin media path — path style avoids query-string issues in image caches. */
export function mediaProxyPath(key: string) {
  const clean = key.replace(/^\/+/, "");
  return `/api/media/${clean
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

/** Pull an R2 object key from a stored URL and/or explicit key. */
export function extractStorageKey(
  url?: string | null,
  key?: string | null
): string | null {
  const direct = key?.trim().replace(/^\/+/, "");
  if (direct) return direct;

  const raw = url?.trim() || "";
  if (!raw) return null;

  try {
    let pathOnly = raw;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const u = new URL(raw);
      // /api/media?key=ads%2F...
      const qKey = u.searchParams.get("key");
      if (qKey?.trim()) return qKey.trim().replace(/^\/+/, "");
      pathOnly = u.pathname;
    } else if (raw.includes("?")) {
      const u = new URL(raw, "http://local");
      const qKey = u.searchParams.get("key");
      if (qKey?.trim()) return qKey.trim().replace(/^\/+/, "");
      pathOnly = u.pathname;
    }

    const decoded = decodeURIComponent(pathOnly);

    if (decoded.startsWith("/uploads/")) {
      const k = decoded.slice("/uploads/".length);
      return k || null;
    }

    if (decoded.startsWith("/api/media/")) {
      const k = decoded.slice("/api/media/".length);
      return k || null;
    }

    // From CDN / any absolute path: find a known R2 folder prefix.
    const stripped = decoded.replace(/^\/+/, "");
    for (const prefix of R2_KEY_PREFIXES) {
      const idx = stripped.indexOf(prefix);
      if (idx >= 0) return stripped.slice(idx);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve a client-facing media URL.
 * When an R2 key is known, always return the same-origin `/api/media/...` gateway
 * (streams via R2 credentials). Do not depend on R2_PUBLIC_URL being publicly reachable.
 */
export async function resolvePublicMediaUrl(
  url?: string | null,
  key?: string | null
): Promise<string | null> {
  const storageKey = extractStorageKey(url, key);
  const trimmed = url?.trim() || "";

  if (storageKey && isR2Configured()) {
    return mediaProxyPath(storageKey);
  }

  if (storageKey && PUBLIC_URL) {
    return `${PUBLIC_URL}/${storageKey}`;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    // Dead host /uploads absolute URLs → recover key when possible.
    const recovered = extractStorageKey(trimmed, null);
    if (recovered && isR2Configured()) return mediaProxyPath(recovered);
    return trimmed;
  }

  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed) return trimmed;
  return null;
}

/** Best URL to persist after an upload completes. */
export async function preferredStoredMediaUrl(
  key: string,
  _clientPublicUrl?: string | null
): Promise<string> {
  if (isR2Configured()) return mediaProxyPath(key);
  if (PUBLIC_URL) return `${PUBLIC_URL}/${key}`;
  return `/uploads/${key}`;
}

/** Signed GET URL for large video/PDF objects (not for <img> tags). */
export async function resolveSignedMediaUrl(
  url?: string | null,
  key?: string | null
): Promise<string | null> {
  const signed = await resolvePlaybackUrl(key, url, PLAYBACK_URL_EXPIRES_SEC);
  if (signed) return signed;
  return resolvePublicMediaUrl(url, key);
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
