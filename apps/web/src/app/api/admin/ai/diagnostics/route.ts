import { json, requireAuth } from "@/lib/api";
import { AiDiagnosticsService } from "@/services/ai/ai-diagnostics.service";

/** SUPER_ADMIN: run full AI connectivity + KB readiness diagnostics. */
export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const report = await AiDiagnosticsService.run();
  return json(report);
}

export async function POST() {
  return GET();
}
