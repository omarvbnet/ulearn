-- Professional certificates for completed store courses (CERTIFICATE_USER)
CREATE TABLE IF NOT EXISTS "CourseCertificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "courseDescription" TEXT,
    "teacherName" TEXT NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "completionDate" TIMESTAMP(3) NOT NULL,
    "pdfKey" TEXT,
    "pdfUrl" TEXT,
    "qrCodeData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CourseCertificate_certificateNumber_key"
  ON "CourseCertificate"("certificateNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "CourseCertificate_verificationCode_key"
  ON "CourseCertificate"("verificationCode");

CREATE UNIQUE INDEX IF NOT EXISTS "CourseCertificate_userId_courseId_key"
  ON "CourseCertificate"("userId", "courseId");

CREATE INDEX IF NOT EXISTS "CourseCertificate_verificationCode_idx"
  ON "CourseCertificate"("verificationCode");

CREATE INDEX IF NOT EXISTS "CourseCertificate_certificateNumber_idx"
  ON "CourseCertificate"("certificateNumber");

CREATE INDEX IF NOT EXISTS "CourseCertificate_courseId_idx"
  ON "CourseCertificate"("courseId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CourseCertificate_userId_fkey'
  ) THEN
    ALTER TABLE "CourseCertificate"
      ADD CONSTRAINT "CourseCertificate_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CourseCertificate_courseId_fkey'
  ) THEN
    ALTER TABLE "CourseCertificate"
      ADD CONSTRAINT "CourseCertificate_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
