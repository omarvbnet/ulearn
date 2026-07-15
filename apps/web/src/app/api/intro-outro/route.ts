import { json, optionalAuth } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { VideoService } from "@/services/video.service";
import type { Locale } from "@prisma/client";

/**
 * Public (auth optional) intro/outro clips for the caller's locale.
 * Used by mobile course players when the course payload might not yet include them.
 */
export async function GET() {
  const session = await optionalAuth();
  const user = session?.userId ? await getCurrentUser() : null;
  const locale = (user?.locale ?? "AR") as Locale;
  const introOutro = await VideoService.getPlayableIntroOutro(
    locale,
    user?.countryId ?? undefined
  );
  return json({ introOutro });
}
