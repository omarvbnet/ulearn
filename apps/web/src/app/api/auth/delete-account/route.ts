import { AuthService } from "@/services/auth.service";
import { error, json, requireAuth } from "@/lib/api";

/** User-initiated account deletion (App Store / Google Play requirement). */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const result = await AuthService.requestAccountDeletion(auth.session.userId);
  if (!result.success) {
    return error(result.error, 400, result.error);
  }
  return json(result);
}
