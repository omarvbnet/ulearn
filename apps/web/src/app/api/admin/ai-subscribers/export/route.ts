import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { AiCreativeEntitlementService } from "@/services/ai/creative";
import ExcelJS from "exceljs";

export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const provinceId = searchParams.get("provinceId") || undefined;

  const config = await AiCreativeEntitlementService.getConfig();

  const [subUserIds, jobUserIds] = await Promise.all([
    prisma.subscription.findMany({
      where: { package: { type: "AI_CREATIVE", deletedAt: null } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.aiCreativeJob.findMany({
      where: { status: "SUCCEEDED" },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const userIds = [
    ...new Set([
      ...subUserIds.map((s) => s.userId),
      ...jobUserIds.map((j) => j.userId),
    ]),
  ];

  const users =
    userIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: {
            id: { in: userIds },
            ...(provinceId ? { provinceId } : {}),
          },
          select: {
            fullLegalName: true,
            phone: true,
            province: { select: { nameEn: true } },
            subscriptions: {
              where: {
                status: "ACTIVE",
                package: { type: "AI_CREATIVE", deletedAt: null },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
              include: {
                package: { select: { nameEn: true } },
              },
              take: 1,
              orderBy: { expiresAt: "desc" },
            },
            _count: {
              select: {
                coursePurchases: {
                  where: { status: "PAID" },
                },
                aiCreativeJobs: {
                  where: { status: "SUCCEEDED", countedAsUse: true },
                },
              },
            },
          },
          orderBy: { fullLegalName: "asc" },
        });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("AI Subscribers");
  sheet.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Province", key: "province", width: 18 },
    { header: "Plan", key: "plan", width: 22 },
    { header: "Uses used", key: "used", width: 12 },
    { header: "Uses remaining", key: "remaining", width: 14 },
    { header: "Paid courses", key: "courses", width: 12 },
    { header: "Expires", key: "expires", width: 22 },
  ];

  for (const u of users) {
    const sub = u.subscriptions[0];
    const used = u._count.aiCreativeJobs;
    const courseCount = u._count.coursePurchases;
    let plan = "FREE";
    if (sub) plan = sub.package.nameEn || "MONTHLY";
    else if (courseCount >= config.courseUnlockCount) plan = "COURSES_UNLOCK";

    sheet.addRow({
      name: u.fullLegalName,
      phone: u.phone,
      province: u.province?.nameEn ?? "",
      plan,
      used,
      remaining: Math.max(0, config.freeUses - used),
      courses: courseCount,
      expires: sub?.expiresAt?.toISOString() ?? "",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ulearn-ai-subscribers-${Date.now()}.xlsx"`,
    },
  });
}
