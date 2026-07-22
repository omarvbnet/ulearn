-- Professional certificate track + areas of interest
ALTER TABLE "EducationalStage" ADD COLUMN IF NOT EXISTS "isCertificateTrack" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "EducationalStage_isCertificateTrack_idx" ON "EducationalStage"("isCertificateTrack");

CREATE TABLE IF NOT EXISTS "CertificateProfileInterest" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CertificateProfileInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CertificateProfileInterest_profileId_subjectId_key"
  ON "CertificateProfileInterest"("profileId", "subjectId");
CREATE INDEX IF NOT EXISTS "CertificateProfileInterest_subjectId_idx"
  ON "CertificateProfileInterest"("subjectId");

DO $$ BEGIN
  ALTER TABLE "CertificateProfileInterest"
    ADD CONSTRAINT "CertificateProfileInterest_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CertificateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CertificateProfileInterest"
    ADD CONSTRAINT "CertificateProfileInterest_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
