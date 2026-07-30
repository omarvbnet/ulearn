-- CreateEnum
CREATE TYPE "AiClassroomSessionStatus" AS ENUM ('LIVE', 'PAUSED', 'ENDED');

-- CreateTable
CREATE TABLE "AiClassroomSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AiClassroomSessionStatus" NOT NULL DEFAULT 'LIVE',
    "locale" TEXT NOT NULL,
    "countryCode" TEXT,
    "provinceName" TEXT,
    "materialNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "curriculumOutline" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "beatIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AiClassroomSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiClassroomSession_userId_status_updatedAt_idx" ON "AiClassroomSession"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AiClassroomSession_userId_createdAt_idx" ON "AiClassroomSession"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiClassroomSession" ADD CONSTRAINT "AiClassroomSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
