-- CreateEnum
CREATE TYPE "AiExamAttemptStatus" AS ENUM ('PENDING', 'SUBMITTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AiExamAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "score" INTEGER,
    "maxScore" INTEGER,
    "percentage" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "timeLimitSec" INTEGER NOT NULL,
    "elapsedSec" INTEGER,
    "analysis" TEXT,
    "status" "AiExamAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiExamAttempt_userId_createdAt_idx" ON "AiExamAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiExamAttempt_userId_passed_idx" ON "AiExamAttempt"("userId", "passed");

-- CreateIndex
CREATE INDEX "AiExamAttempt_conversationId_idx" ON "AiExamAttempt"("conversationId");

-- AddForeignKey
ALTER TABLE "AiExamAttempt" ADD CONSTRAINT "AiExamAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExamAttempt" ADD CONSTRAINT "AiExamAttempt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
