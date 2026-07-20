import { requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { DatabaseProviderService } from "@/services/database-provider.service";

/** Download a full JSON backup of the current database. */
export async function GET() {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const backup = await DatabaseProviderService.exportBackup(auth.session.userId);
  const body = JSON.stringify(backup);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ulearn-db-backup-${Date.now()}.json"`,
    },
  });
}
