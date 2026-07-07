"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/overlay";
import { useT } from "@/i18n/client";
import { getLocalizedField } from "@/lib/utils";

type Named = { nameEn: string; nameAr?: string; nameKu?: string; nameTr?: string };

type Lesson = Named & {
  id: string;
  isFree: boolean;
  durationSec: number;
};

type Subject = Named & {
  id: string;
  chapters: (Named & { id: string; lessons: Lesson[] })[];
};

export default function StudentCoursesPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => setSubjects(d.subjects || []));
  }, []);

  return (
    <div>
      <PageHeader title={t.nav.courses} description={t.student.coursesDescription} />

      {subjects === null ? (
        <SkeletonRows rows={4} />
      ) : subjects.length === 0 ? (
        <EmptyState title={t.student.noCourses} hint={t.student.noCoursesHint} />
      ) : (
        <div className="stagger space-y-6">
          {subjects.map((subject) => (
            <Card key={subject.id}>
              <h2 className="text-lg font-semibold text-accent">
                {getLocalizedField(subject, "name", locale)}
              </h2>
              <div className="mt-4 space-y-4">
                {subject.chapters.map((chapter) => (
                  <div key={chapter.id}>
                    <h3 className="font-medium">{getLocalizedField(chapter, "name", locale)}</h3>
                    <ul className="mt-2 space-y-2">
                      {chapter.lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <Link
                            href={`/${locale}/student/lesson/${lesson.id}`}
                            className="card-hover flex items-center justify-between rounded-lg border border-card-border/60 px-3 py-2 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <span className="text-accent">▶</span>
                              {getLocalizedField(lesson, "name", locale)}
                            </span>
                            <span className="flex items-center gap-2">
                              {lesson.durationSec > 0 && (
                                <span className="text-xs text-muted">
                                  {Math.round(lesson.durationSec / 60)} {t.student.min}
                                </span>
                              )}
                              {lesson.isFree ? (
                                <Badge status="FREE">{t.common.free}</Badge>
                              ) : (
                                <Badge status="PENDING">{t.common.locked}</Badge>
                              )}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
