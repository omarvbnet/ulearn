import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  interestSubjectIds: z.array(z.string().min(1)).min(1).max(5),
  educationalQualification: z.string().optional().nullable(),
  specialization: z.string().optional().nullable(),
  occupation: z.string().optional().nullable(),
});

/** Certificate user: update areas of interest (and optional profile fields). */
export async function PATCH(request: Request) {
  const auth = await requireAuth(["CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return error("Select 1–5 areas of interest", 422, "VALIDATION");
  }

  const interestIds = [...new Set(parsed.data.interestSubjectIds)];
  const interests = await prisma.subject.findMany({
    where: {
      id: { in: interestIds },
      deletedAt: null,
      isActive: true,
      stage: { isCertificateTrack: true, deletedAt: null },
    },
    select: { id: true },
  });
  if (interests.length !== interestIds.length) {
    return error("Invalid areas of interest", 422, "INVALID_INTERESTS");
  }

  const profile = await prisma.certificateProfile.findUnique({
    where: { userId: auth.session.userId },
  });
  if (!profile) {
    return error("Certificate profile not found", 404, "NOT_FOUND");
  }

  await prisma.$transaction([
    prisma.certificateProfileInterest.deleteMany({ where: { profileId: profile.id } }),
    prisma.certificateProfileInterest.createMany({
      data: interestIds.map((subjectId) => ({
        profileId: profile.id,
        subjectId,
      })),
    }),
    prisma.certificateProfile.update({
      where: { id: profile.id },
      data: {
        educationalQualification:
          parsed.data.educationalQualification === undefined
            ? undefined
            : parsed.data.educationalQualification,
        specialization:
          parsed.data.specialization === undefined
            ? undefined
            : parsed.data.specialization,
        occupation:
          parsed.data.occupation === undefined ? undefined : parsed.data.occupation,
      },
    }),
  ]);

  const updated = await prisma.certificateProfile.findUnique({
    where: { id: profile.id },
    include: {
      interests: {
        include: {
          subject: {
            select: {
              id: true,
              nameEn: true,
              nameAr: true,
              nameKu: true,
              nameTr: true,
              stageId: true,
            },
          },
        },
      },
    },
  });

  return json({ certificateProfile: updated });
}

export async function GET() {
  const auth = await requireAuth(["CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const profile = await prisma.certificateProfile.findUnique({
    where: { userId: auth.session.userId },
    include: {
      interests: {
        include: {
          subject: {
            select: {
              id: true,
              nameEn: true,
              nameAr: true,
              nameKu: true,
              nameTr: true,
              stageId: true,
            },
          },
        },
      },
    },
  });

  return json({ certificateProfile: profile });
}
