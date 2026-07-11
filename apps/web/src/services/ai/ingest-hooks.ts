import { KnowledgeBaseService, type KbMeta } from "@/services/ai/knowledge-base.service";

const TEXT_MIME = /pdf|text\/|wordprocessingml|msword|\.pdf$|\.txt$|\.docx?$/i;

export function isIngestableDocument(mimeType?: string | null, fileName?: string | null) {
  const hay = `${mimeType || ""} ${fileName || ""}`;
  return TEXT_MIME.test(hay);
}

/** Non-blocking KB ingest for course / curriculum documents. */
export function enqueueCourseMaterialIngest(material: {
  id: string;
  title: string;
  fileKey?: string | null;
  fileUrl?: string | null;
  mimeType?: string | null;
  courseId: string;
  lessonId?: string | null;
}) {
  if (!isIngestableDocument(material.mimeType, material.title)) return;
  void KnowledgeBaseService.ingestFromSource("COURSE_MATERIAL", material.id, {
    fileName: material.title,
    fileKey: material.fileKey,
    fileUrl: material.fileUrl,
    mimeType: material.mimeType,
    meta: {
      courseId: material.courseId,
      lesson: material.lessonId || undefined,
    } satisfies KbMeta,
  }).catch(() => {});
}

export function enqueueLessonContentIngest(content: {
  id: string;
  type: string;
  fileKey: string;
  fileUrl?: string | null;
  mimeType?: string | null;
  titleEn?: string | null;
  titleAr?: string | null;
  lessonId: string;
}) {
  if (content.type === "VIDEO") return;
  const fileName =
    content.titleEn || content.titleAr || content.fileKey.split("/").pop() || "lesson-content";
  if (!isIngestableDocument(content.mimeType, fileName)) return;
  void KnowledgeBaseService.ingestFromSource("LESSON_CONTENT", content.id, {
    fileName,
    fileKey: content.fileKey,
    fileUrl: content.fileUrl,
    mimeType: content.mimeType,
    meta: { lesson: content.lessonId },
  }).catch(() => {});
}
