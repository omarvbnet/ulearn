-- Advertisement: per-language targeting
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "locale" "Locale" NOT NULL DEFAULT 'AR';
ALTER TABLE "Advertisement" ADD COLUMN IF NOT EXISTS "title" TEXT;

CREATE INDEX IF NOT EXISTS "Advertisement_locale_isActive_sortOrder_idx"
  ON "Advertisement"("locale", "isActive", "sortOrder");

-- TeacherProfile: school vs certificate teaching track
DO $$ BEGIN
  CREATE TYPE "TeachingTrack" AS ENUM ('SCHOOL', 'CERTIFICATE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "TeacherProfile" ADD COLUMN IF NOT EXISTS "teachingTrack" "TeachingTrack" NOT NULL DEFAULT 'SCHOOL';

CREATE INDEX IF NOT EXISTS "TeacherProfile_teachingTrack_idx"
  ON "TeacherProfile"("teachingTrack");
