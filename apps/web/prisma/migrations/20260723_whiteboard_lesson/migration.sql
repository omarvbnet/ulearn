-- CreateEnum
CREATE TYPE "CourseLessonType" AS ENUM ('VIDEO', 'WHITEBOARD');

-- CreateEnum
CREATE TYPE "WhiteboardTheme" AS ENUM ('WHITE', 'BLACK');

-- CreateTable
CREATE TABLE "WhiteboardAsset" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "courseLessonId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sourceFilename" TEXT,
    "fileSize" BIGINT,
    "durationSec" INTEGER,
    "thumbnailKey" TEXT,
    "theme" "WhiteboardTheme" NOT NULL DEFAULT 'WHITE',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "processingStatus" "VideoProcessingStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "processingError" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhiteboardAsset_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CourseLesson" ADD COLUMN "lessonType" "CourseLessonType" NOT NULL DEFAULT 'VIDEO';
ALTER TABLE "CourseLesson" ADD COLUMN "whiteboardAssetId" TEXT;

-- AlterTable
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN "whiteboardAssetId" TEXT;
ALTER TABLE "CourseLessonUpdateRequest" ADD COLUMN "previousWhiteboardAssetId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_whiteboardAssetId_key" ON "CourseLesson"("whiteboardAssetId");
CREATE INDEX "CourseLesson_lessonType_idx" ON "CourseLesson"("lessonType");
CREATE INDEX "WhiteboardAsset_courseId_idx" ON "WhiteboardAsset"("courseId");
CREATE INDEX "WhiteboardAsset_processingStatus_idx" ON "WhiteboardAsset"("processingStatus");
CREATE INDEX "WhiteboardAsset_uploadedById_idx" ON "WhiteboardAsset"("uploadedById");

-- AddForeignKey
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_whiteboardAssetId_fkey" FOREIGN KEY ("whiteboardAssetId") REFERENCES "WhiteboardAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhiteboardAsset" ADD CONSTRAINT "WhiteboardAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
