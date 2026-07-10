import { error, json, requireAuth } from "@/lib/api";
import { STAFF_ROLES } from "@/lib/auth/session";
import { buildKey, getUploadUrl, maxSizeLabel, mediaProxyPath, validateFile } from "@/lib/r2";

const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

/**
 * Issue an upload URL for videos, PDFs, and images.
 * Uses presigned R2 URLs in production; falls back to local disk storage
 * (public/uploads) when R2 is not configured, so uploads work in development.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(STAFF_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { filename, contentType, size, category, folder } = body as {
    filename?: string;
    contentType?: string;
    size?: number;
    category?: "image" | "video" | "document";
    folder?: string;
  };

  if (!filename || !contentType || !size || !category) {
    return error("filename, contentType, size, and category are required", 422, "VALIDATION");
  }

  const validation = validateFile(contentType, size, category, filename);
  if (!validation.valid) {
    const message =
      validation.error === "FILE_TOO_LARGE"
        ? `File is too large — maximum size for ${category} is ${maxSizeLabel(category)}`
        : `This file type is not supported for ${category} uploads`;
    return error(message, 422, validation.error);
  }

  const key = buildKey(folder ?? category, filename, auth.session.userId);

  if (!r2Configured) {
    return json({
      uploadUrl: `/api/admin/uploads/local?key=${encodeURIComponent(key)}`,
      key,
      publicUrl: `/uploads/${key}`,
    });
  }

  const upload = await getUploadUrl({
    key,
    contentType,
    category,
    size,
  });
  return json({
    uploadUrl: upload.uploadUrl,
    key: upload.key,
    expiresIn: upload.expiresIn,
    // Same-origin gateway — works even when the R2 bucket is private.
    publicUrl: mediaProxyPath(key),
  });
}
