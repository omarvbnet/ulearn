import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import ExcelJS from "exceljs";

/** Export the latest 5000 audit logs to Excel. */
export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 5000,
    include: { actor: { select: { fullLegalName: true, phone: true, role: true } } },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Audit Logs");

  sheet.columns = [
    { header: "Time", key: "time", width: 22 },
    { header: "Action", key: "action", width: 26 },
    { header: "Entity", key: "entity", width: 18 },
    { header: "Entity ID", key: "entityId", width: 28 },
    { header: "Actor", key: "actor", width: 24 },
    { header: "Actor Role", key: "role", width: 16 },
    { header: "IP", key: "ip", width: 16 },
  ];

  for (const l of logs) {
    sheet.addRow({
      time: l.createdAt.toISOString(),
      action: l.action,
      entity: l.entityType,
      entityId: l.entityId,
      actor: l.actor?.fullLegalName ?? l.actor?.phone ?? "system",
      role: l.actor?.role ?? "",
      ip: l.ipAddress ?? "",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ulearn-logs-${Date.now()}.xlsx"`,
    },
  });
}
