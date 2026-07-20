import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth/session";
import type { UserRole } from "@prisma/client";

/** JSON.stringify cannot serialize BigInt (Prisma VideoAsset.fileSize, raw COUNT, etc.). */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  return value;
}

export function json<T>(data: T, status = 200) {
  return new NextResponse(JSON.stringify(data, jsonReplacer), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(
  message: string,
  status = 400,
  code?: string,
  extra?: Record<string, unknown>
) {
  return new NextResponse(
    JSON.stringify({ error: message, code, ...extra }, jsonReplacer),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function requireAuth(
  roles?: UserRole[],
  options?: { requireApproved?: boolean }
): Promise<
  | { session: SessionPayload; error?: never }
  | { session?: never; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { error: error("Unauthorized", 401, "UNAUTHORIZED") };
  }
  if (roles && !roles.includes(session.role)) {
    return { error: error("Forbidden", 403, "FORBIDDEN") };
  }
  if (options?.requireApproved && session.status !== "APPROVED") {
    return {
      error: error("Account pending approval", 403, "ACCOUNT_PENDING"),
    };
  }
  return { session };
}

/** Session if present; otherwise null (for public browse endpoints). */
export async function optionalAuth(): Promise<SessionPayload | null> {
  return getSession();
}

export function getClientIp(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  );
}

/** Simple in-memory rate limiter for OTP endpoints. */
const rateMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || entry.resetAt < now) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count };
}
