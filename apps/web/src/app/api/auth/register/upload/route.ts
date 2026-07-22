import { error, json } from "@/lib/api";
import { buildKey, getUploadUrl, maxSizeLabel, validateFile } from "@/lib/r2";
import { z } from "zod";

const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

const schema = z.object({
  /** Optional for older clients; used only to namespace the R2 key. */
  phone: z.string().min(1).optional().nullable(),
  filename: z.string().min(1),
  contentType: z.string().optional().nullable(),
  size: z.coerce.number().int().positive(),
});

function inferImageContentType(filename: string, provided?: string | null): string {
  const trimmed = provided?.trim();
  if (trimmed) return trimmed;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

/** Public: presigned upload for national ID image during registration. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return error(
      issue?.message
        ? `Invalid upload request: ${issue.path.join(".") || "body"} — ${issue.message}`
        : "Invalid upload request (filename and size are required)",
      422,
      "VALIDATION",
      { issues: parsed.error.issues }
    );
  }

  const filename = parsed.data.filename;
  const contentType = inferImageContentType(filename, parsed.data.contentType);
  const size = parsed.data.size;
  const phone = parsed.data.phone?.trim() || "unknown";

  const validation = validateFile(contentType, size, "image", filename);
  if (!validation.valid) {
    const message =
      validation.error === "FILE_TOO_LARGE"
        ? `File is too large — maximum size for images is ${maxSizeLabel("image")}`
        : "Only JPEG, PNG, WebP, GIF, or HEIC images are allowed for ID upload";
    return error(message, 422, validation.error);
  }

  const safePhone = phone.replace(/\D/g, "") || "unknown";
  const key = buildKey(`register-ids/${safePhone}`, filename, "register");

  if (!r2Configured) {
    return json({
      uploadUrl: `/api/admin/uploads/local?key=${encodeURIComponent(key)}`,
      key,
      publicUrl: `/uploads/${key}`,
      contentType,
    });
  }

  const upload = await getUploadUrl({ key, contentType });
  return json({ ...upload, contentType });
}
