import { AuthService } from "@/services/auth.service";
import { json } from "@/lib/api";

export async function POST() {
  await AuthService.logout();
  return json({ success: true });
}
