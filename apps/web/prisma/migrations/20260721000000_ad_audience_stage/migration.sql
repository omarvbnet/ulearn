-- Advertisement targeting by role audience + optional educational stage
CREATE TYPE "AdAudience" AS ENUM ('ALL', 'STUDENT', 'CERTIFICATE_USER', 'TEACHER');

ALTER TABLE "Advertisement"
  ADD COLUMN IF NOT EXISTS "audience" "AdAudience" NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS "stageId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Advertisement_stageId_fkey'
  ) THEN
    ALTER TABLE "Advertisement"
      ADD CONSTRAINT "Advertisement_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "EducationalStage"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Advertisement_audience_isActive_sortOrder_idx"
  ON "Advertisement"("audience", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "Advertisement_stageId_idx"
  ON "Advertisement"("stageId");
