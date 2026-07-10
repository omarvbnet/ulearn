import { getCurrentUser } from "@/lib/auth/session";
import { error, json } from "@/lib/api";
import { resolvePublicMediaUrl } from "@/lib/r2";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);

  const profilePhotoUrl =
    (await resolvePublicMediaUrl(user.profilePhotoUrl, user.profilePhotoKey).catch(
      () => null
    )) ?? user.profilePhotoUrl;

  return json({
    user: {
      ...user,
      profilePhotoUrl,
    },
  });
}
