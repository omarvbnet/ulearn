import { error, json } from "@/lib/api";
import { buildKey, getUploadUrl, maxSizeLabel, validateFile } from "@/lib/r2";
import { z } from "zod";

const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

const schema = z.object({
  phone: z.string().min(8),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

/** Public: presigned upload for national ID image during registration. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { phone, filename, contentType, size } = parsed.data;
  const validation = validateFile(contentType, size, "image", filename);
  if (!validation.valid) {
    const message =
      validation.error === "FILE_TOO_LARGE"
        ? `File is too large — maximum size for images is ${maxSizeLabel("image")}`
        : "Only JPEG, PNG, or WebP images are allowed for ID upload";
    return error(message, 422, validation.error);
  }

  const safePhone = phone.replace(/\D/g, "");
  const key = buildKey(`register-ids/${safePhone}`, filename, "register");

  if (!r2Configured) {
    return json({
      uploadUrl: `/api/admin/uploads/local?key=${encodeURIComponent(key)}`,
      key,
      publicUrl: `/uploads/${key}`,
    });
  }

  const upload = await getUploadUrl({ key, contentType });
  return json(upload);
}
