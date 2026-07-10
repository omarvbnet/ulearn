/** Lessons/videos visible to students in the store. */
export const PUBLIC_LESSON_WHERE = {
  deletedAt: null,
  isHidden: false,
} as const;

/** Short reels visible in the public feed. */
export const PUBLIC_SHORT_VIDEO_WHERE = {
  status: "APPROVED" as const,
  deletedAt: null,
  isHidden: false,
};

export type AdminVisibilityFilter = "visible" | "hidden" | "deleted" | "all";

export function visibilityWhere(filter: AdminVisibilityFilter = "visible") {
  switch (filter) {
    case "hidden":
      return { deletedAt: null, isHidden: true };
    case "deleted":
      return { deletedAt: { not: null } };
    case "all":
      return {};
    case "visible":
    default:
      return { deletedAt: null, isHidden: false };
  }
}

export function parseAdminVisibility(value: string | null): AdminVisibilityFilter {
  if (value === "hidden" || value === "deleted" || value === "all") return value;
  return "visible";
}

export function tokenizeSearch(q: string) {
  return q
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function buildTokenAndClauses<T extends Record<string, unknown>>(
  tokens: string[],
  builders: ((token: string) => T | T[])[]
): T[] {
  if (tokens.length === 0) return [];
  return tokens.flatMap((token) => builders.flatMap((b) => {
    const clause = b(token);
    return Array.isArray(clause) ? clause : [clause];
  }));
}
