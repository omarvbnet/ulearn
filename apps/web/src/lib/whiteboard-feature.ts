import { prisma } from "@/lib/prisma";
import { withCache, CacheTTL } from "@/lib/prisma-cache";

export const WHITEBOARD_LESSONS_SETTING_KEY = "whiteboard_lessons_enabled";

function coerceEnabled(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

/**
 * Admin-controlled feature flag for Whiteboard Lesson Studio.
 * Defaults to enabled when the setting row is missing (so existing installs keep working
 * until an admin explicitly turns it off).
 */
export async function isWhiteboardLessonsEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findFirst(
    withCache(
      {
        where: { key: WHITEBOARD_LESSONS_SETTING_KEY, countryId: null },
        select: { value: true },
      },
      CacheTTL.settings
    )
  );
  if (!row) return true;
  return coerceEnabled(row.value);
}
