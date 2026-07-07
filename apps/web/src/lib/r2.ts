import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.R2_BUCKET || "ulearn";
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

export async function getUploadUrl(params: {
  key: string;
  contentType: string;
  expiresIn?: number;
}) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: params.key,
    ContentType: params.contentType,
  });

  const url = await getSignedUrl(r2, command, {
    expiresIn: params.expiresIn ?? 3600,
  });

  return {
    uploadUrl: url,
    key: params.key,
    publicUrl: PUBLIC_URL ? `${PUBLIC_URL}/${params.key}` : undefined,
  };
}

export async function getDownloadUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn });
}

export async function deleteObject(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export function buildKey(folder: string, filename: string, userId?: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const prefix = userId ? `${folder}/${userId}` : folder;
  return `${prefix}/${Date.now()}-${safe}`;
}
