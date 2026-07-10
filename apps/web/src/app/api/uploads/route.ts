import { error, json, requireAuth } from "@/lib/api";
import { buildKey, getUploadUrl, maxSizeLabel, validateFile } from "@/lib/r2";

const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

/**
 * Student uploads (stage-change certificates). Images and documents only.
 * Returns a presigned R2 PUT URL, or a local fallback in development.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { filename, contentType, size, category } = body as {
    filename?: string;
    contentType?: string;
    size?: number;
    category?: "image" | "document";
  };

  if (!filename || !contentType || !size || !category) {
    return error("filename, contentType, size, and category are required", 422, "VALIDATION");
  }
  if (category !== "image" && category !== "document") {
    return error("Only image and document uploads are allowed", 422, "VALIDATION");
  }

  const validation = validateFile(contentType, size, category, filename);
  if (!validation.valid) {
    const message =
      validation.error === "FILE_TOO_LARGE"
        ? `File is too large — maximum size for ${category} is ${maxSizeLabel(category)}`
        : `This file type is not supported for ${category} uploads`;
    return error(message, 422, validation.error);
  }

  const key = buildKey("stage-certificates", filename, auth.session.userId);

  if (!r2Configured) {
    return json({
      uploadUrl: `/api/uploads/local?key=${encodeURIComponent(key)}`,
      key,
      publicUrl: `/uploads/${key}`,
    });
  }

  const upload = await getUploadUrl({ key, contentType });
  return json({
    ...upload,
    publicUrl: upload.publicUrl ?? `/api/media?key=${encodeURIComponent(key)}`,
  });
}
