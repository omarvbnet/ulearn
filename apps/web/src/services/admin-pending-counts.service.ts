import { prisma } from "@/lib/prisma";

type PendingCountsRow = {
  users: bigint;
  courses: bigint;
  lesson_updates: bigint;
  purchases: bigint;
  product_purchases: bigint;
  short_videos: bigint;
  stage_requests: bigint;
  subscriptions: bigint;
  complaints: bigint;
  content_reports: bigint;
};

const n = (v: bigint) => Number(v);

/** Pending review/approval counts for admin navigation badges. */
export class AdminPendingCountsService {
  /** Single round-trip — avoids exhausting small Prisma Postgres pools (limit ~5). */
  static async getCounts() {
    const [row] = await prisma.$queryRaw<PendingCountsRow[]>`
      SELECT
        (SELECT COUNT(*)::bigint FROM "User"
          WHERE status = 'PENDING' AND "deletedAt" IS NULL) AS users,
        (SELECT COUNT(*)::bigint FROM "Course"
          WHERE status = 'PENDING_REVIEW' AND "deletedAt" IS NULL) AS courses,
        (SELECT COUNT(*)::bigint FROM "CourseLessonUpdateRequest"
          WHERE status = 'PENDING') AS lesson_updates,
        (SELECT COUNT(*)::bigint FROM "CoursePurchase"
          WHERE status = 'PENDING') AS purchases,
        (SELECT COUNT(*)::bigint FROM "ProductPurchase"
          WHERE status = 'PENDING') AS product_purchases,
        (SELECT COUNT(*)::bigint FROM "TeacherShortVideo"
          WHERE status = 'PENDING_REVIEW' AND "deletedAt" IS NULL) AS short_videos,
        (SELECT COUNT(*)::bigint FROM "StageChangeRequest"
          WHERE status = 'PENDING') AS stage_requests,
        (SELECT COUNT(*)::bigint FROM "ActivationRequest"
          WHERE status = 'PENDING') AS subscriptions,
        (SELECT COUNT(*)::bigint FROM "Complaint"
          WHERE status = 'OPEN') AS complaints,
        (SELECT COUNT(*)::bigint FROM "ContentReport"
          WHERE status = 'PENDING') AS content_reports
    `;

    if (!row) {
      return {
        users: 0,
        courseReview: 0,
        shortVideos: 0,
        stageRequests: 0,
        subscriptions: 0,
        products: 0,
        complaints: 0,
        contentReports: 0,
        total: 0,
      };
    }

    const users = n(row.users);
    const courseReview = n(row.courses) + n(row.lesson_updates) + n(row.purchases);
    const shortVideos = n(row.short_videos);
    const stageRequests = n(row.stage_requests);
    const subscriptions = n(row.subscriptions);
    const products = n(row.product_purchases);
    const complaints = n(row.complaints);
    const contentReports = n(row.content_reports);

    return {
      users,
      courseReview,
      shortVideos,
      stageRequests,
      subscriptions,
      products,
      complaints,
      contentReports,
      total:
        users +
        courseReview +
        shortVideos +
        stageRequests +
        subscriptions +
        products +
        complaints +
        contentReports,
    };
  }
}
