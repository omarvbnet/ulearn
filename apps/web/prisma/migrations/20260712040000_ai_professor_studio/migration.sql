-- AlterEnum AiModuleKey
ALTER TYPE "AiModuleKey" ADD VALUE IF NOT EXISTS 'PROFESSOR_CONTENT';
ALTER TYPE "AiModuleKey" ADD VALUE IF NOT EXISTS 'PROFESSOR_DOCUMENT';

-- AlterEnum KbSourceType
ALTER TYPE "KbSourceType" ADD VALUE IF NOT EXISTS 'TEACHER_UPLOAD';

-- CreateEnum
CREATE TYPE "ProfessorJobType" AS ENUM (
  'INGEST',
  'GENERATE_CONTENT',
  'DOCUMENT_ACTION',
  'PDF_TOOL',
  'EXPORT',
  'GENERATE_EXAM',
  'GRADE_ASSIST'
);

CREATE TYPE "ProfessorJobStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "ProfessorGenerationType" AS ENUM (
  'LECTURE',
  'NOTES',
  'STUDY_GUIDE',
  'TEACHING_MANUAL',
  'SYLLABUS',
  'LESSON_PLAN',
  'WEEKLY_PLAN',
  'SEMESTER_PLAN',
  'LEARNING_OUTCOMES',
  'PRESENTATION_OUTLINE',
  'CUSTOM'
);

CREATE TYPE "ProfessorArtifactKind" AS ENUM (
  'MARKDOWN',
  'HTML',
  'PDF',
  'DOCX',
  'PPTX',
  'JSON',
  'FLASHCARDS',
  'MIND_MAP'
);

CREATE TABLE "ProfessorJob" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "type" "ProfessorJobType" NOT NULL,
    "status" "ProfessorJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "inputJson" JSONB,
    "resultJson" JSONB,
    "documentId" TEXT,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProfessorJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfessorGeneration" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "type" "ProfessorGenerationType" NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "params" JSONB,
    "markdown" TEXT,
    "status" "ProfessorJobStatus" NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "courseId" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessorGeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfessorArtifact" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "generationId" TEXT,
    "jobId" TEXT,
    "documentId" TEXT,
    "kind" "ProfessorArtifactKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT,
    "fileUrl" TEXT,
    "contentText" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessorArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfessorQuestionBankItem" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "subject" TEXT,
    "chapter" TEXT,
    "lesson" TEXT,
    "topic" TEXT,
    "difficulty" TEXT,
    "bloom" TEXT,
    "questionType" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "text" TEXT NOT NULL,
    "options" JSONB,
    "correctKey" TEXT,
    "answerKey" TEXT,
    "marks" DOUBLE PRECISION DEFAULT 1,
    "timeEstimateSec" INTEGER,
    "courseId" TEXT,
    "documentId" TEXT,
    "generationId" TEXT,
    "examVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessorQuestionBankItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KbDocument_instructorId_status_idx" ON "KbDocument"("instructorId", "status");
CREATE INDEX IF NOT EXISTS "KbDocument_instructorId_uploadedAt_idx" ON "KbDocument"("instructorId", "uploadedAt");

CREATE INDEX "ProfessorJob_instructorId_createdAt_idx" ON "ProfessorJob"("instructorId", "createdAt");
CREATE INDEX "ProfessorJob_instructorId_status_idx" ON "ProfessorJob"("instructorId", "status");
CREATE INDEX "ProfessorJob_generationId_idx" ON "ProfessorJob"("generationId");

CREATE INDEX "ProfessorGeneration_instructorId_updatedAt_idx" ON "ProfessorGeneration"("instructorId", "updatedAt");
CREATE INDEX "ProfessorGeneration_instructorId_type_idx" ON "ProfessorGeneration"("instructorId", "type");
CREATE INDEX "ProfessorGeneration_parentId_idx" ON "ProfessorGeneration"("parentId");

CREATE INDEX "ProfessorArtifact_instructorId_createdAt_idx" ON "ProfessorArtifact"("instructorId", "createdAt");
CREATE INDEX "ProfessorArtifact_generationId_idx" ON "ProfessorArtifact"("generationId");
CREATE INDEX "ProfessorArtifact_documentId_idx" ON "ProfessorArtifact"("documentId");
CREATE INDEX "ProfessorArtifact_jobId_idx" ON "ProfessorArtifact"("jobId");

CREATE INDEX "ProfessorQuestionBankItem_instructorId_createdAt_idx" ON "ProfessorQuestionBankItem"("instructorId", "createdAt");
CREATE INDEX "ProfessorQuestionBankItem_instructorId_subject_chapter_idx" ON "ProfessorQuestionBankItem"("instructorId", "subject", "chapter");
CREATE INDEX "ProfessorQuestionBankItem_instructorId_difficulty_idx" ON "ProfessorQuestionBankItem"("instructorId", "difficulty");
CREATE INDEX "ProfessorQuestionBankItem_instructorId_questionType_idx" ON "ProfessorQuestionBankItem"("instructorId", "questionType");
CREATE INDEX "ProfessorQuestionBankItem_courseId_idx" ON "ProfessorQuestionBankItem"("courseId");

ALTER TABLE "ProfessorJob" ADD CONSTRAINT "ProfessorJob_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessorJob" ADD CONSTRAINT "ProfessorJob_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ProfessorGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProfessorGeneration" ADD CONSTRAINT "ProfessorGeneration_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessorGeneration" ADD CONSTRAINT "ProfessorGeneration_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProfessorGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProfessorArtifact" ADD CONSTRAINT "ProfessorArtifact_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessorArtifact" ADD CONSTRAINT "ProfessorArtifact_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ProfessorGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProfessorQuestionBankItem" ADD CONSTRAINT "ProfessorQuestionBankItem_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
