import { error, json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import {
  DatabaseProviderService,
  type DbProviderKind,
} from "@/services/database-provider.service";
import { z } from "zod";

export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const data = await DatabaseProviderService.listPublic();
  return json(data);
}

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  kind: z.enum(["PRISMA_POSTGRES", "SUPABASE", "VPS_POSTGRES", "LOCAL_CUSTOM"]),
  databaseUrl: z.string().min(1),
  directUrl: z.string().min(1),
  accelerateUrl: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const parsed = upsertSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid input", 422, "VALIDATION");

  try {
    const profile = await DatabaseProviderService.upsertProfile(
      {
        ...parsed.data,
        kind: parsed.data.kind as DbProviderKind,
      },
      auth.session.userId
    );
    return json({ profile }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FAILED";
    return error(msg, 400, msg);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return error("id required", 422, "VALIDATION");

  try {
    await DatabaseProviderService.deleteProfile(id, auth.session.userId);
    return json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FAILED";
    return error(msg, 400, msg);
  }
}
