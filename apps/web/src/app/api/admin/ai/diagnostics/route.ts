import { error, json, requireAuth } from "@/lib/api";
import { AiDiagnosticsService } from "@/services/ai/ai-diagnostics.service";

/** SUPER_ADMIN: run full AI connectivity + KB readiness diagnostics. */
export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  try {
    const report = await AiDiagnosticsService.run();
    return json(report);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Diagnostics failed", 500, "DIAGNOSTICS_FAILED");
  }
}

export async function POST() {
  return GET();
}
