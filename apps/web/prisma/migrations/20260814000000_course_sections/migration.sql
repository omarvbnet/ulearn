-- New courses group videos/UBRD under sections. Existing courses stay flat.
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "usesSections" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CourseSection" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourseSection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CourseSection_courseId_idx" ON "CourseSection"("courseId");
CREATE INDEX IF NOT EXISTS "CourseSection_deletedAt_idx" ON "CourseSection"("deletedAt");

ALTER TABLE "CourseSection"
  ADD CONSTRAINT "CourseSection_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseLesson" ADD COLUMN IF NOT EXISTS "sectionId" TEXT;

CREATE INDEX IF NOT EXISTS "CourseLesson_sectionId_idx" ON "CourseLesson"("sectionId");

ALTER TABLE "CourseLesson"
  ADD CONSTRAINT "CourseLesson_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
