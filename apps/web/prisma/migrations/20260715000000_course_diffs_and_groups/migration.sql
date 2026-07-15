-- Course review snapshots
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "lastApprovedSnapshot" JSONB;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "pendingChangeSummary" JSONB;

-- Lesson update previous-value snapshots
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "previousTitle" TEXT;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "previousFileKey" TEXT;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "previousFileUrl" TEXT;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "previousThumbnailKey" TEXT;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "previousThumbnailUrl" TEXT;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "previousDurationSec" INTEGER;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN IF NOT EXISTS "changeSummary" TEXT;

-- Course groups
CREATE TABLE IF NOT EXISTS "CourseGroup" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT,
    "titleKu" TEXT,
    "titleTr" TEXT,
    "description" TEXT,
    "coverKey" TEXT,
    "coverUrl" TEXT,
    "stageId" TEXT NOT NULL,
    "countryId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IQD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourseGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CourseGroupItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CourseGroupItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CourseGroupPurchase" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IQD',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseGroupPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CourseGroup_stageId_idx" ON "CourseGroup"("stageId");
CREATE INDEX IF NOT EXISTS "CourseGroup_isActive_idx" ON "CourseGroup"("isActive");
CREATE INDEX IF NOT EXISTS "CourseGroup_deletedAt_idx" ON "CourseGroup"("deletedAt");
CREATE INDEX IF NOT EXISTS "CourseGroupItem_courseId_idx" ON "CourseGroupItem"("courseId");
CREATE UNIQUE INDEX IF NOT EXISTS "CourseGroupItem_groupId_courseId_key" ON "CourseGroupItem"("groupId", "courseId");
CREATE INDEX IF NOT EXISTS "CourseGroupPurchase_userId_idx" ON "CourseGroupPurchase"("userId");
CREATE INDEX IF NOT EXISTS "CourseGroupPurchase_status_idx" ON "CourseGroupPurchase"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "CourseGroupPurchase_groupId_userId_key" ON "CourseGroupPurchase"("groupId", "userId");

DO $$ BEGIN
  ALTER TABLE "CourseGroup" ADD CONSTRAINT "CourseGroup_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "EducationalStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseGroup" ADD CONSTRAINT "CourseGroup_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseGroupItem" ADD CONSTRAINT "CourseGroupItem_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "CourseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseGroupItem" ADD CONSTRAINT "CourseGroupItem_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseGroupPurchase" ADD CONSTRAINT "CourseGroupPurchase_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "CourseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CourseGroupPurchase" ADD CONSTRAINT "CourseGroupPurchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
