import { error, json, requireAuth } from "@/lib/api";
import { AiProviderService } from "@/services/ai";
import { AiModuleKey } from "@prisma/client";
import { z } from "zod";

export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const assignments = await AiProviderService.listModuleAssignments();
  return json({ assignments });
}

export async function PUT(request: Request) {
  const auth = await requireAuth(["SUPER_ADMIN"]);
  if (auth.error) return auth.error;
  const parsed = z
    .object({
      assignments: z.array(
        z.object({
          moduleKey: z.nativeEnum(AiModuleKey),
          providerId: z.string().min(1),
        })
      ),
    })
    .safeParse(await request.json());
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  const results = [];
  try {
    for (const a of parsed.data.assignments) {
      results.push(await AiProviderService.setModuleAssignment(a.moduleKey, a.providerId));
    }
  } catch (e) {
    return error(e instanceof Error ? e.message : "Assignment failed", 400, "INVALID_ASSIGNMENT");
  }
  return json({ assignments: results });
}
