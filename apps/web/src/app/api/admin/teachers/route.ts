import { error, json, requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { AuthService } from "@/services/auth.service";
import { MAX_TEACHER_SPECIALTIES } from "@/services/teacher-profile.service";

export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const teachers = await prisma.user.findMany({
    where: { role: "TEACHER", deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      country: { select: { nameEn: true, code: true } },
      teacherProfile: {
        include: {
          subjects: {
            include: { subject: { select: { id: true, nameEn: true } } },
          },
          _count: { select: { ratings: true, complaints: true } },
        },
      },
    },
  });

  return json({ teachers });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { phone, fullLegalName, email, countryId, provinceId, specializations, subjectIds } = body;

  if (!phone || !fullLegalName) {
    return error("phone and fullLegalName are required", 422, "VALIDATION");
  }

  if (subjectIds != null) {
    const ids = Array.isArray(subjectIds) ? subjectIds : [];
    if (ids.length > MAX_TEACHER_SPECIALTIES) {
      return error(`Teachers can have at most ${MAX_TEACHER_SPECIALTIES} specialties`, 422, "VALIDATION");
    }
  }

  const existing = await prisma.user.findUnique({
    where: { phone: String(phone).replace(/\s+/g, "") },
  });
  if (existing) {
    return error("A user with this phone already exists", 409, "PHONE_TAKEN");
  }

  const teacher = await AuthService.createStaffUser({
    phone,
    fullLegalName,
    email,
    role: "TEACHER",
    countryId,
    provinceId,
    specializations,
    subjectIds,
    actorId: auth.session.userId,
  });

  return json({ teacher }, 201);
}
