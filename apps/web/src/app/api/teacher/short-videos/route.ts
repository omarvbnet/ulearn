import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1),
  fileKey: z.string().optional(),
  fileUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().int().optional(),
});

export async function GET() {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
  });
  if (!teacher) return error("Teacher not found", 404);

  const videos = await prisma.teacherShortVideo.findMany({
    where: { teacherId: teacher.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { likes: true } } },
  });

  return json({ videos });
}

export async function POST(request: Request) {
  const auth = await requireAuth(["TEACHER"]);
  if (auth.error) return auth.error;

  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId: auth.session.userId, deletedAt: null },
  });
  if (!teacher) return error("Teacher not found", 404);

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const video = await prisma.teacherShortVideo.create({
    data: { teacherId: teacher.id, ...parsed.data, status: "PENDING_REVIEW" },
  });

  return json({ video }, 201);
}
