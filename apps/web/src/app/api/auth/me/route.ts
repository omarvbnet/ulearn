import { getCurrentUser } from "@/lib/auth/session";
import { error, json } from "@/lib/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return error("Unauthorized", 401);
  return json({ user });
}
