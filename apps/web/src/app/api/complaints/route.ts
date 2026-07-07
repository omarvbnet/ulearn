import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/** Students file a complaint (optionally against a teacher). */
export async function POST(request: Request) {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const { subject, description, teacherId } = (await request.json()) as {
    subject?: string;
    description?: string;
    teacherId?: string;
  };

  if (!subject?.trim() || !description?.trim()) {
    return error("subject and description are required", 422, "VALIDATION");
  }

  const complaint = await prisma.complaint.create({
    data: {
      studentId: auth.session.userId,
      teacherId: teacherId || null,
      subject: subject.trim(),
      description: description.trim(),
    },
  });

  return json({ complaint }, 201);
}

/** List the current user's complaints. */
export async function GET() {
  const auth = await requireAuth(["STUDENT", "CERTIFICATE_USER"]);
  if (auth.error) return auth.error;

  const complaints = await prisma.complaint.findMany({
    where: { studentId: auth.session.userId },
    orderBy: { createdAt: "desc" },
    include: {
      teacher: { include: { user: { select: { fullLegalName: true } } } },
    },
  });

  return json({ complaints });
}
