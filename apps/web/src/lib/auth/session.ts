import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { UserRole, UserStatus } from "@prisma/client";

const COOKIE_NAME = "ulearn_session";
const SESSION_DAYS = 30;

function getSecret() {
  const secret = process.env.JWT_SECRET || "ulearn-dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
}

export async function createSession(
  userId: string,
  role: UserRole,
  status: UserStatus,
  meta?: { deviceId?: string; ipAddress?: string; userAgent?: string }
): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  const session = await prisma.session.create({
    data: {
      userId,
      token: crypto.randomUUID(),
      deviceId: meta?.deviceId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      expiresAt,
    },
  });

  const token = await new SignJWT({
    userId,
    role,
    status,
    sessionId: session.id,
  } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_DAYS}d`)
    .setIssuedAt()
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.userId, deletedAt: null },
    include: {
      studentProfile: {
        include: {
          educationalStage: {
            select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
          },
        },
      },
      certificateProfile: {
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
                  stage: {
                    select: {
                      id: true,
                      nameEn: true,
                      nameAr: true,
                      nameKu: true,
                      nameTr: true,
                      isCertificateTrack: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      teacherProfile: {
        include: {
          subjects: {
            include: {
              subject: {
                select: {
                  id: true,
                  nameEn: true,
                  nameAr: true,
                  nameKu: true,
                  nameTr: true,
                },
              },
            },
          },
        },
      },
      country: true,
      province: true,
    },
  });

  return user;
}

export async function destroySession() {
  const session = await getSession();
  if (session?.sessionId) {
    await prisma.session.deleteMany({ where: { id: session.sessionId } });
  }
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function hasRole(role: UserRole, allowed: UserRole[]): boolean {
  return allowed.includes(role);
}

export const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "COUNTRY_ADMIN"];
export const STAFF_ROLES: UserRole[] = ["SUPER_ADMIN", "COUNTRY_ADMIN", "TEACHER"];
