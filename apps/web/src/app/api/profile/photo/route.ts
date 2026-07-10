import { error, json, requireAuth } from "@/lib/api";
import { buildKey, getUploadUrl, maxSizeLabel, mediaProxyPath, preferredStoredMediaUrl, validateFile } from "@/lib/r2";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const PROFILE_ROLES = ["STUDENT", "CERTIFICATE_USER", "TEACHER"] as const;

const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

function profilePhotoFolder(userId: string) {
  return `profile-photos/${userId}`;
}

/** Request a presigned URL to upload a profile photo (students & teachers). */
export async function POST(request: Request) {
  const auth = await requireAuth([...PROFILE_ROLES]);
  if (auth.error) return auth.error;

  const body = (await request.json()) as {
    filename?: string;
    contentType?: string;
    size?: number;
  };

  if (!body.filename || !body.contentType || !body.size) {
    return error("filename, contentType, and size are required", 422, "VALIDATION");
  }

  const validation = validateFile(body.contentType, body.size, "image", body.filename);
  if (!validation.valid) {
    const message =
      validation.error === "FILE_TOO_LARGE"
        ? `File is too large — maximum size for images is ${maxSizeLabel("image")}`
        : "Only JPEG, PNG, WebP, or GIF images are allowed";
    return error(message, 422, validation.error);
  }

  const key = buildKey(profilePhotoFolder(auth.session.userId), body.filename, auth.session.userId);

  if (!r2Configured) {
    return json({
      uploadUrl: `/api/profile/photo/local?key=${encodeURIComponent(key)}`,
      key,
      publicUrl: `/uploads/${key}`,
    });
  }

  const upload = await getUploadUrl({ key, contentType: body.contentType });
  return json({
    uploadUrl: upload.uploadUrl,
    key: upload.key,
    expiresIn: upload.expiresIn,
    publicUrl: mediaProxyPath(key),
  });
}

const patchSchema = z.object({
  profilePhotoKey: z.string().min(1),
  profilePhotoUrl: z.string().min(1).optional(),
});

/** Save profile photo after upload completes. */
export async function PATCH(request: Request) {
  const auth = await requireAuth([...PROFILE_ROLES]);
  if (auth.error) return auth.error;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const { profilePhotoKey, profilePhotoUrl } = parsed.data;
  const prefix = `${profilePhotoFolder(auth.session.userId)}/`;
  if (!profilePhotoKey.startsWith(prefix)) {
    return error("Invalid photo key", 403, "FORBIDDEN");
  }

  const url = await preferredStoredMediaUrl(profilePhotoKey, profilePhotoUrl);

  const user = await prisma.user.update({
    where: { id: auth.session.userId },
    data: { profilePhotoKey, profilePhotoUrl: url },
    include: {
      studentProfile: {
        include: {
          educationalStage: {
            select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
          },
        },
      },
      certificateProfile: true,
      teacherProfile: { include: { subjects: true } },
    },
  });

  return json({ user });
}

/** Remove profile photo. */
export async function DELETE() {
  const auth = await requireAuth([...PROFILE_ROLES]);
  if (auth.error) return auth.error;

  const user = await prisma.user.update({
    where: { id: auth.session.userId },
    data: { profilePhotoKey: null, profilePhotoUrl: null },
    include: {
      studentProfile: {
        include: {
          educationalStage: {
            select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
          },
        },
      },
      certificateProfile: true,
      teacherProfile: { include: { subjects: true } },
    },
  });

  return json({ user });
}
