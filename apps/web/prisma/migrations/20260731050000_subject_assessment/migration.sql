-- CreateEnum
CREATE TYPE "PerformanceLevel" AS ENUM ('BEGINNER', 'BASIC', 'DEVELOPING', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "LearningTrend" AS ENUM ('RAPID_IMPROVEMENT', 'STEADY_IMPROVEMENT', 'STABLE', 'SLIGHT_DECLINE', 'CRITICAL_DECLINE');

-- CreateTable
CREATE TABLE "SubjectAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "masteryScore" INTEGER NOT NULL DEFAULT 0,
    "performanceLevel" "PerformanceLevel" NOT NULL DEFAULT 'BEGINNER',
    "aiConfidenceScore" INTEGER NOT NULL DEFAULT 0,
    "retentionScore" INTEGER NOT NULL DEFAULT 0,
    "problemSolvingScore" INTEGER,
    "practicalSkillsScore" INTEGER,
    "criticalThinkingScore" INTEGER,
    "communicationScore" INTEGER,
    "creativityScore" INTEGER,
    "learningSpeedScore" INTEGER,
    "participationScore" INTEGER,
    "homeworkScore" INTEGER,
    "quizAccuracyScore" INTEGER,
    "attendanceScore" INTEGER,
    "consistencyScore" INTEGER,
    "improvementScore" INTEGER,
    "trend" "LearningTrend" NOT NULL DEFAULT 'STABLE',
    "trendHistory" JSONB NOT NULL DEFAULT '[]',
    "lastComputedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubjectAssessment_userId_subjectId_key" ON "SubjectAssessment"("userId", "subjectId");

-- CreateIndex
CREATE INDEX "SubjectAssessment_subjectId_masteryScore_idx" ON "SubjectAssessment"("subjectId", "masteryScore");

-- AddForeignKey
ALTER TABLE "SubjectAssessment" ADD CONSTRAINT "SubjectAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessment" ADD CONSTRAINT "SubjectAssessment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
