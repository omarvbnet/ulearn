-- AI Creative Studio: package type, module key, jobs table

ALTER TYPE "PackageType" ADD VALUE IF NOT EXISTS 'AI_CREATIVE';

ALTER TYPE "AiModuleKey" ADD VALUE IF NOT EXISTS 'AI_CREATIVE';

DO $$ BEGIN
  CREATE TYPE "AiCreativeTool" AS ENUM (
    'MERGE',
    'DESIGN_PPT',
    'DESIGN_PDF',
    'IMAGE_EDIT',
    'IMAGE_DESIGN'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AiCreativeJobStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCEEDED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "AiCreativeJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" "AiCreativeTool" NOT NULL,
    "status" "AiCreativeJobStatus" NOT NULL DEFAULT 'PENDING',
    "inputMeta" JSONB,
    "resultFileName" TEXT,
    "resultMime" TEXT,
    "resultContent" TEXT,
    "error" TEXT,
    "countedAsUse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCreativeJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiCreativeJob_userId_status_idx" ON "AiCreativeJob"("userId", "status");
CREATE INDEX IF NOT EXISTS "AiCreativeJob_userId_createdAt_idx" ON "AiCreativeJob"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiCreativeJob_countedAsUse_idx" ON "AiCreativeJob"("countedAsUse");

DO $$ BEGIN
  ALTER TABLE "AiCreativeJob"
    ADD CONSTRAINT "AiCreativeJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
