import { error, json, requireAuth } from "@/lib/api";
import { AiProviderService } from "@/services/ai";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const result = await AiProviderService.test(id);
    return json(result);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Test failed", 500, "TEST_FAILED");
  }
}
