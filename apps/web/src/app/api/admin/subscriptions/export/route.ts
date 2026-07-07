import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import ExcelJS from "exceljs";

/** Export all subscriptions to Excel. */
export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const subscriptions = await prisma.subscription.findMany({
    include: {
      user: { select: { fullLegalName: true, phone: true } },
      package: { select: { nameEn: true, type: true, price: true, currency: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Subscriptions");

  sheet.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "User", key: "user", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Package", key: "package", width: 26 },
    { header: "Type", key: "type", width: 16 },
    { header: "Price", key: "price", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Devices", key: "devices", width: 8 },
    { header: "Starts", key: "starts", width: 20 },
    { header: "Expires", key: "expires", width: 20 },
    { header: "Activated By", key: "activatedBy", width: 16 },
  ];

  for (const s of subscriptions) {
    sheet.addRow({
      id: s.id,
      user: s.user.fullLegalName,
      phone: s.user.phone,
      package: s.package.nameEn,
      type: s.package.type,
      price: `${s.package.price} ${s.package.currency}`,
      status: s.status,
      devices: s.deviceLimit,
      starts: s.startsAt?.toISOString() ?? "",
      expires: s.expiresAt?.toISOString() ?? "",
      activatedBy: s.activatedBy ?? "",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ulearn-subscriptions-${Date.now()}.xlsx"`,
    },
  });
}
