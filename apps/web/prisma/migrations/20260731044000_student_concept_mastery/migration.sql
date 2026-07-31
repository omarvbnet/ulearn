-- AlterTable
ALTER TABLE "StudentAiMemory" ADD COLUMN IF NOT EXISTS "conceptMastery" JSONB;
ALTER TABLE "StudentAiMemory" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT;
