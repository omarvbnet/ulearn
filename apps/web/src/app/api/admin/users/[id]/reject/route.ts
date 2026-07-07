import { AuthService } from "@/services/auth.service";
import { error, json, requireAuth } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const { reason } = await request.json().catch(() => ({ reason: undefined }));
  const result = await AuthService.rejectUser(id, auth.session.userId, reason);
  if (!result.success) return error(result.error, 400);
  return json(result);
}
