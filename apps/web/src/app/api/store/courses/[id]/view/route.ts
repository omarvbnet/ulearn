import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Counts a course view (fired when a student opens the course detail). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const course = await prisma.course.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });
    return json({ viewCount: course.viewCount });
  } catch {
    return error("Course not found", 404, "NOT_FOUND");
  }
}
