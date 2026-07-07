import { AuthService } from "@/services/auth.service";
import { error, json, requireAuth } from "@/lib/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await AuthService.suspendUser(id, auth.session.userId);
  if (!result.success) return error(result.error, 400);
  return json(result);
}
