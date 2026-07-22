import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import ExcelJS from "exceljs";

export async function GET() {
  const auth = await requireAuth(["SUPER_ADMIN", "COUNTRY_ADMIN"]);
  if (auth.error) return auth.error;

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: { country: true, province: true, studentProfile: true },
    orderBy: { createdAt: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Users");

  sheet.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "Name", key: "name", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Email", key: "email", width: 24 },
    { header: "Role", key: "role", width: 16 },
    { header: "Status", key: "status", width: 12 },
    { header: "Gender", key: "gender", width: 10 },
    { header: "Country", key: "country", width: 16 },
    { header: "Province", key: "province", width: 16 },
    { header: "National ID", key: "nationalId", width: 16 },
    { header: "Created At", key: "createdAt", width: 20 },
  ];

  for (const u of users) {
    sheet.addRow({
      id: u.id,
      name: u.fullLegalName,
      phone: u.phone,
      email: u.email,
      role: u.role,
      status: u.status,
      gender: u.gender,
      country: u.country?.nameEn,
      province: u.province?.nameEn,
      nationalId: u.nationalId,
      createdAt: u.createdAt.toISOString(),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ulearn-users-${Date.now()}.xlsx"`,
    },
  });
}
