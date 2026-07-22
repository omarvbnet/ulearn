import { json, requireAuth } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/r2";
import type { StageRequestStatus } from "@prisma/client";

const stageSelect = {
  select: { id: true, nameEn: true, nameAr: true, nameKu: true, nameTr: true },
};

/** Admin: list stage-change requests (default: pending). */
export async function GET(request: Request) {
  const auth = await requireAuth(ADMIN_ROLES);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "PENDING") as StageRequestStatus;

  const requests = await prisma.stageChangeRequest.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { id: true, fullLegalName: true, phone: true } },
      currentStage: stageSelect,
      requestedStage: stageSelect,
    },
  });

  // Resolve certificate links (presigned when stored on R2).
  const out = await Promise.all(
    requests.map(async (r) => {
      let certificateUrl = r.certificateUrl;
      if (r.certificateKey && (!certificateUrl || !certificateUrl.startsWith("http"))) {
        certificateUrl =
          (await getDownloadUrl(r.certificateKey).catch(() => null)) ?? certificateUrl;
      }
      return { ...r, certificateUrl };
    })
  );

  return json({ requests: out });
}
