-- Whiteboard lesson edit: store dirty time ranges for admin before/after review.
ALTER TABLE "CourseLessonUpdateRequest"
  ADD COLUMN IF NOT EXISTS "editDiffJson" JSONB;
