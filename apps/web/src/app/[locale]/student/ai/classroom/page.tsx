"use client";

import { useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LiveClassroom } from "@/components/ai/classroom/live-classroom";

export default function StudentAiClassroomPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const locale = String(params?.locale || "en");

  const documentIds = useMemo(() => {
    const raw = search.get("docs") || "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [search]);

  const question = search.get("q") || "";

  return (
    <LiveClassroom
      locale={locale}
      documentIds={documentIds}
      question={question}
      onClose={() => router.push(`/${locale}/student/ai`)}
    />
  );
}
