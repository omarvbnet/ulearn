import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const SHORT_VIDEO_ROLES = ["TEACHER", "SUPER_ADMIN", "COUNTRY_ADMIN"] as const;

const schema = z.object({
  title: z.string().min(1),
  description: z.string().max(500).optional(),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  thumbnailKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
});

export async function GET() {
  const auth = await requireAuth([...SHORT_VIDEO_ROLES]);
  if (auth.error) return auth.error;

  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: { id: true, countryId: true, provinceId: true },
  });
  if (!user) return error("User not found", 404, "NOT_FOUND");

  const teacher = await prisma.teacherProfile.upsert({
    where: { userId: auth.session.userId },
    create: {
      userId: auth.session.userId,
      countryId: user.countryId,
      provinceId: user.provinceId,
    },
    update: {
      deletedAt: null,
      countryId: user.countryId,
      provinceId: user.provinceId,
      isActive: true,
    },
  });

  const videos = await prisma.teacherShortVideo.findMany({
    where: { teacherId: teacher.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          likes: true,
          saves: true,
          comments: { where: { deletedAt: null } },
        },
      },
    },
  });

  return json({
    videos: videos.map((v) => ({
      ...v,
      likes: v._count.likes,
      saves: v._count.saves,
      commentCount: v._count.comments,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth([...SHORT_VIDEO_ROLES]);
  if (auth.error) return auth.error;

  const user = await prisma.user.findUnique({
    where: { id: auth.session.userId },
    select: { id: true, countryId: true, provinceId: true },
  });
  if (!user) return error("User not found", 404, "NOT_FOUND");

  const teacher = await prisma.teacherProfile.upsert({
    where: { userId: auth.session.userId },
    create: {
      userId: auth.session.userId,
      countryId: user.countryId,
      provinceId: user.provinceId,
    },
    update: {
      deletedAt: null,
      countryId: user.countryId,
      provinceId: user.provinceId,
      isActive: true,
    },
  });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const video = await prisma.teacherShortVideo.create({
    data: { teacherId: teacher.id, ...parsed.data, status: "PENDING_REVIEW" },
  });

  return json({ video }, 201);
}
