"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import type { AiTeacherLessonView } from "@/components/ai/ai-teacher-lesson-card";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

function looksLikeAiTeacherMarkdownDump(text: string): boolean {
  return (
    /###\s*Lesson\s*\(spoken\)/i.test(text) ||
    /###\s*Board actions/i.test(text) ||
    /###\s*Lesson\s*\(spoken\)|###\s*الملخص|Board actions/i.test(text)
  );
}

function lessonFromCitations(
  citations: unknown
): AiTeacherLessonView | null {
  if (!citations || typeof citations !== "object") return null;
  const raw = (citations as { aiTeacherLesson?: unknown }).aiTeacherLesson;
  if (!raw || typeof raw !== "object") return null;
  const lesson = raw as AiTeacherLessonView;
  if (!Array.isArray(lesson.speech) || lesson.speech.length === 0) return null;
  return lesson;
}

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  exam?: PracticeExam | null;
  examDone?: boolean;
  result?: ExamResult | null;
  aiTeacherLesson?: AiTeacherLessonView | null;
  selectableMaterials?: Array<{ id: string; fileName: string }>;
  pendingMode?: "exam" | "explain_observe" | "ai_teacher" | string;
  pendingQuestion?: string;
  file?: {
    fileName: string;
    mimeType?: string;
    contentBase64?: string;
    downloadUrl?: string;
  } | null;
};

type PracticeExam = {
  examAttemptId: string;
  title: string;
  timeLimitSec: number;
  questions: Array<{
    text: string;
    options: Record<string, string>;
    imageBase64?: string;
  }>;
};

type ExamResult = {
  percentage: number;
  passed: boolean;
  score: number;
  maxScore: number;
  analysis?: string;
  review?: Array<{ text: string; isCorrect: boolean }>;
};

type KbDoc = { id: string; fileName: string };
type Conv = { id: string; title?: string | null; updatedAt?: string };

export default function StudentAiPage() {
  const t = useT();
  const { locale } = useParams<{ locale: string }>();
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<
    "exam" | "explain_observe" | "ai_teacher"
  >("exam");
  const [pendingExplainQuestion, setPendingExplainQuestion] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [examCount, setExamCount] = useState<5 | 10 | 20>(5);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [preparingClassroom, setPreparingClassroom] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const quickPrompts =
    locale === "ar"
      ? [
          "احتاج ملخص عن المادة",
          "احتاج مرشحات وزارية عن المادة",
          "أنشئ رسوم تعليمية واضحة عن الدرس",
          "صمم إنفوجرافيك تعليمي عن الموضوع",
          "اشرح درس اليوم خطوة بخطوة",
        ]
      : locale === "ku"
        ? [
            "پێویستم بە پوختەی وانە/ماددەکە هەیە",
            "پێویستم بە فلتەری وەزاری هەیە بۆ ماددەکە",
            "وێنەی فێرکاری ڕوون بۆ وانەکە دروست بکە",
            "ئینفۆگرافیکێکی فێرکاری دیزاین بکە",
            "وانەی ئەمڕۆ هەنگاو بە هەنگاو ڕوون بکەرەوە",
          ]
        : locale === "tr"
          ? [
              "Bu ders/materyal için net bir özet istiyorum",
              "Bu ders için bakanlık tarzı sınav filtreleri istiyorum",
              "Ders için net eğitim çizimleri oluştur",
              "Konu için eğitim infografiği tasarla",
              "Bugünkü dersi adım adım anlat",
            ]
          : [
              "I need a clear summary of this subject/material",
              "I need ministry-style exam filters for this subject",
              "Create clear educational drawings for this lesson",
              "Design an educational infographic on this topic",
              "Explain today's lesson step by step",
            ];

  const attachmentPrompts = [
    locale === "ar"
      ? "لخص المادة من الملفات المرفقة بوضوح"
      : "Summarize the attached material clearly",
    locale === "ar"
      ? "أنشئ مرشحات وزارية من المادة المرفقة"
      : "Create ministry-style exam filters from the attached material",
    locale === "ar"
      ? "صمم عرض PowerPoint من الملفات المرفقة"
      : "Design a PowerPoint presentation from my attached file(s)",
    locale === "ar"
      ? "صمم ملف PDF من الملفات المرفقة"
      : "Design a PDF from my attached file(s)",
    locale === "ar"
      ? "صمم ملف Word من الملفات المرفقة"
      : "Design a Word document from my attached file(s)",
    locale === "ar"
      ? "صمم صورة تعليمية / إنفوجرافيك من الملفات المرفقة"
      : "Design an educational image / infographic from my attached file(s)",
    locale === "ar"
      ? "أنشئ رسومات هندسية وتوضيحية تُدرج داخل الملف"
      : "Create engineering/illustrative diagrams to insert into the file",
    ...(pendingFiles.some((f) => f.type.startsWith("image/"))
      ? [
          locale === "ar"
            ? "عدّل الصورة المرفقة لتكون أوضح تعليمياً"
            : "Edit the attached image to make it clearer for teaching",
        ]
      : []),
    ...(pendingFiles.filter(
      (f) => f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf")
    ).length >= 2
      ? [
          locale === "ar"
            ? "ادمج ملفات PDF المرفقة في ملف واحد"
            : "Merge the attached PDF files into one file",
        ]
      : []),
  ];

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/ai/conversations");
    if (!res.ok) return;
    const data = await res.json();
    setConversations(data.conversations || []);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function uploadAttachment(file: File) {
    const category = file.type.startsWith("image/") ? "image" : "document";
    const useInline = !file.type.includes("pdf") && file.size < 300_000;
    if (useInline) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      return {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: btoa(binary),
      };
    }
    const presignRes = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        category,
        folder: "ai-creative",
      }),
    });
    const presign = await presignRes.json();
    if (!presignRes.ok) throw new Error(presign.error || "Upload failed");
    const put = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error("File upload failed");
    return {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileKey: presign.key as string,
      fileUrl: presign.publicUrl as string | undefined,
    };
  }

  async function downloadChatFile(file: NonNullable<ChatMsg["file"]>) {
    if (file.contentBase64) {
      const bin = atob(file.contentBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: file.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (file.downloadUrl) {
      const res = await fetch(file.downloadUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function sendChat(question?: string) {
    const q = (question ?? input).trim();
    if ((!q && !pendingFiles.length) || sending) return;
    setSending(true);
    setInput("");
    const files = [...pendingFiles];
    setPendingFiles([]);
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: q || (files.length ? `Attached: ${files.map((f) => f.name).join(", ")}` : ""),
      },
    ]);
    try {
      const attachments =
        files.length > 0
          ? await Promise.all(files.map((f) => uploadAttachment(f)))
          : undefined;
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          language: locale,
          conversationId: conversationId || undefined,
          attachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat failed");
      if (data.needsMaterialSelection) {
        const materials = Array.isArray(data.materials)
          ? (data.materials as Array<{ id: string; fileName: string }>)
          : [];
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: data.answer || "",
            selectableMaterials: materials,
            pendingMode:
              data.pendingMode === "ai_teacher"
                ? "ai_teacher"
                : data.pendingMode === "practice_quiz"
                  ? "exam"
                  : "explain_observe",
            pendingQuestion: String(data.pendingQuestion || q || "").trim() || q,
          },
        ]);
        setPendingExplainQuestion(
          String(data.pendingQuestion || q || "").trim() || q
        );
        if (!materials.length) {
          await openMaterialPicker("explain_observe");
        }
        return;
      }
      setConversationId(data.conversationId || conversationId);
      const edited = data.editedFile as ChatMsg["file"] | undefined;
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.aiTeacherLesson ? "" : data.answer || "",
          aiTeacherLesson: (data.aiTeacherLesson as AiTeacherLessonView) || null,
          file: edited
            ? {
                fileName: edited.fileName,
                mimeType: edited.mimeType,
                contentBase64: edited.contentBase64,
                downloadUrl: edited.downloadUrl,
              }
            : null,
        },
      ]);
      void loadHistory();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Chat failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function reopenClassroomFromLesson(lesson: AiTeacherLessonView) {
    const docs = (lesson.documentIds || []).filter(Boolean);
    if (!docs.length) return;
    const params = new URLSearchParams();
    params.set("docs", docs.join(","));
    if (lesson.lesson_title) params.set("q", lesson.lesson_title);
    router.push(`/${locale}/student/ai/classroom?${params.toString()}`);
  }

  async function requestTeacherClassroom(opts: {
    question: string;
    documentIds?: string[];
    addUserBubble?: boolean;
  }) {
    const q = opts.question.trim();
    if (sending) return;

    const docIds = (opts.documentIds || []).filter(Boolean);
    if (docIds.length) {
      if (opts.addUserBubble !== false) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "user",
            text:
              q ||
              (locale === "ar"
                ? "ابدأ الفصل المباشر على السبورة"
                : "Start the live whiteboard classroom"),
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text:
              locale === "ar"
                ? "جاري فتح الفصل المباشر…"
                : "Opening the live classroom…",
          },
        ]);
      }
      const params = new URLSearchParams();
      params.set("docs", docIds.join(","));
      if (q) params.set("q", q);
      router.push(`/${locale}/student/ai/classroom?${params.toString()}`);
      return;
    }

    setSending(true);
    setPreparingClassroom(true);
    if (opts.addUserBubble !== false) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "user",
          text:
            q ||
            (locale === "ar"
              ? "ابدأ الفصل المباشر على السبورة"
              : "Start the live whiteboard classroom"),
        },
      ]);
    }
    try {
      const res = await fetch("/api/ai/classroom/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            q ||
            (locale === "ar"
              ? "ابدأ درس السبورة الصوتي من المادة المختارة"
              : "Start an AI teacher board lesson from the selected material"),
          language: locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI Teacher failed");

      if (data.needsUpgrade) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: data.answer || "Upgrade required",
          },
        ]);
        return;
      }

      if (data.needsMaterialSelection) {
        const materials = Array.isArray(data.materials)
          ? (data.materials as Array<{ id: string; fileName: string }>)
          : [];
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text:
              data.answer ||
              (locale === "ar"
                ? "اختر المادة لفتح الفصل المباشر على السبورة"
                : "Choose a material to open the live whiteboard classroom"),
            selectableMaterials: materials,
            pendingMode: "ai_teacher",
            pendingQuestion: String(data.pendingQuestion || q || "").trim() || q,
          },
        ]);
        setPendingExplainQuestion(
          String(data.pendingQuestion || q || "").trim() || q
        );
        setPickerMode("ai_teacher");
        if (!materials.length) {
          await openMaterialPicker("ai_teacher");
        }
        return;
      }

      throw new Error(
        locale === "ar"
          ? "اختر المادة لفتح الفصل المباشر"
          : "Choose a material to open the live classroom"
      );
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "AI Teacher failed",
        },
      ]);
    } finally {
      setSending(false);
      setPreparingClassroom(false);
    }
  }

  async function sendAiTeacherLesson(question?: string) {
    const q = (question ?? input).trim();
    if (sending) return;
    if (!q) {
      setPendingExplainQuestion("");
      await openMaterialPicker("ai_teacher");
      return;
    }
    setInput("");
    await requestTeacherClassroom({ question: q });
  }

  async function openConversation(id: string) {
    setSending(true);
    try {
      const res = await fetch(`/api/ai/conversations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setConversationId(id);
      const msgs = (data.conversation?.messages || []) as Array<{
        id: string;
        role: string;
        content: string;
        citations?: {
          practiceQuiz?: PracticeExam;
          review?: Array<{ text: string; isCorrect: boolean }>;
          aiTeacherLesson?: AiTeacherLessonView;
        };
      }>;
      setMessages(
        msgs.map((m) => {
          const practice = m.citations?.practiceQuiz;
          const hasReview = Array.isArray(m.citations?.review);
          const aiTeacherLesson = lessonFromCitations(m.citations);
          const raw = m.content || "";
          const hideDump =
            Boolean(aiTeacherLesson) || looksLikeAiTeacherMarkdownDump(raw);
          return {
            id: m.id,
            role: m.role === "USER" ? "user" : "assistant",
            text: hideDump ? "" : raw,
            aiTeacherLesson,
            exam: practice || null,
            examDone: Boolean(practice),
            result: hasReview
              ? {
                  percentage: 0,
                  passed: false,
                  score: 0,
                  maxScore: (m.citations?.review || []).length,
                  analysis: m.content,
                  review: m.citations?.review,
                }
              : null,
          };
        })
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
  }

  async function openMaterialPicker(
    mode: "exam" | "explain_observe" | "ai_teacher" = "exam"
  ) {
    const res = await fetch("/api/ai/kb-documents");
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || t.student.aiNoMaterials);
      return;
    }
    const list = (data.documents || []) as KbDoc[];
    if (!list.length) {
      const pending = Number(data.meta?.pendingForStage || 0);
      const failed = Number(data.meta?.failedCount || 0);
      const insights = data.meta?.scope === "insights";
      const reason = data.meta?.emptyReason as string | undefined;
      const emptyMsg =
        reason === "failed" || (pending === 0 && failed > 0)
          ? insights
            ? t.student.aiMaterialsFailedInsights
            : t.student.aiMaterialsFailedStage
          : reason === "processing" || pending > 0
            ? insights
              ? t.student.aiMaterialsProcessingInsights
              : t.student.aiMaterialsProcessingStage
            : insights
              ? t.student.aiNoMaterialsInsights
              : t.student.aiNoMaterialsStage;
      alert(emptyMsg || t.student.aiNoMaterials);
      return;
    }
    setDocs(list);
    setSelectedDocs([]);
    setExamCount(5);
    setPickerMode(mode);
    setPickerOpen(true);
  }

  async function openExamPicker() {
    await openMaterialPicker("exam");
  }

  async function continueWithMaterial(opts: {
    documentId: string;
    mode?: string;
    question?: string;
  }) {
    if (sending || !opts.documentId) return;
    if (opts.mode === "ai_teacher") {
      await requestTeacherClassroom({
        question:
          (opts.question || "").trim() ||
          (locale === "ar"
            ? "ابدأ درس السبورة الصوتي من المادة المختارة"
            : "Start an AI teacher board lesson from the selected material"),
        documentIds: [opts.documentId],
      });
      return;
    }
    const mode =
      opts.mode === "exam" || opts.mode === "practice_quiz"
        ? "practice_quiz"
        : "explain_observe";
    const question =
      (opts.question || "").trim() ||
      (locale === "ar"
        ? "اشرح المادة وساعدني على ملاحظة الأشكال"
        : "Explain the material and help me observe the shapes");

    setSending(true);
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: question },
    ]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          language: locale,
          mode,
          documentIds: [opts.documentId],
          conversationId: conversationId || undefined,
          ...(mode === "practice_quiz" ? { count: examCount } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setConversationId(data.conversationId || conversationId);
      const edited = data.editedFile as ChatMsg["file"] | undefined;
      const practice = data.practiceQuiz as PracticeExam | undefined;
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer || "",
          exam: practice || null,
          examDone: false,
          file: edited
            ? {
                fileName: edited.fileName,
                mimeType: edited.mimeType,
                contentBase64: edited.contentBase64,
                downloadUrl: edited.downloadUrl,
              }
            : null,
        },
      ]);
      setPendingExplainQuestion("");
      void loadHistory();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function confirmMaterialPicker() {
    if (!selectedDocs.length) return;
    if (pickerMode === "exam") {
      await generateExam();
      return;
    }
    if (pickerMode === "ai_teacher") {
      setPickerOpen(false);
      const question =
        pendingExplainQuestion.trim() ||
        (locale === "ar"
          ? "ابدأ درس السبورة الصوتي من المادة المختارة"
          : "Start an AI teacher board lesson from the selected material");
      setPendingExplainQuestion("");
      await requestTeacherClassroom({
        question,
        documentIds: selectedDocs,
      });
      return;
    }
    setPickerOpen(false);
    setSending(true);
    const prompt =
      pendingExplainQuestion.trim() ||
      (locale === "ar"
        ? "اشرح المادة وساعدني على ملاحظة الأشكال"
        : "Explain the material and help me observe the shapes");
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: prompt },
    ]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          language: locale,
          mode: "explain_observe",
          documentIds: selectedDocs,
          conversationId: conversationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setConversationId(data.conversationId || conversationId);
      const edited = data.editedFile as ChatMsg["file"] | undefined;
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer || "",
          file: edited
            ? {
                fileName: edited.fileName,
                mimeType: edited.mimeType,
                contentBase64: edited.contentBase64,
                downloadUrl: edited.downloadUrl,
              }
            : null,
        },
      ]);
      setPendingExplainQuestion("");
      void loadHistory();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function generateExam() {
    if (!selectedDocs.length) return;
    setPickerOpen(false);
    setSending(true);
    const prompt = "Generate a practice exam from my selected materials";
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: prompt }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          language: locale,
          mode: "practice_quiz",
          documentIds: selectedDocs,
          count: examCount,
          conversationId: conversationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Exam failed");
      setConversationId(data.conversationId || conversationId);
      const practice = data.practiceQuiz as PracticeExam | undefined;
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer || "",
          exam: practice
            ? {
                ...practice,
                examAttemptId: practice.examAttemptId || data.examAttemptId,
              }
            : null,
        },
      ]);
      void loadHistory();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: e instanceof Error ? e.message : "Exam failed",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function submitExam(
    msgId: string,
    exam: PracticeExam,
    answers: Record<string, string>,
    elapsedSec: number,
    expired: boolean
  ) {
    const res = await fetch("/api/ai/exams/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examAttemptId: exam.examAttemptId,
        answers,
        elapsedSec,
        expired,
        language: locale,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submit failed");
    setMessages((m) => [
      ...m.map((x) => (x.id === msgId ? { ...x, examDone: true } : x)),
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "",
        result: data as ExamResult,
      },
    ]);
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 rounded-2xl border border-border bg-card p-3 lg:w-64">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t.student.aiHistory}</h2>
          <Button type="button" variant="outline" onClick={newChat}>
            {t.student.aiNewChat}
          </Button>
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto lg:max-h-[70vh]">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => openConversation(c.id)}
              className={cn(
                "w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/5",
                conversationId === c.id && "bg-accent/15 text-accent"
              )}
            >
              {c.title?.trim() || "Chat"}
            </button>
          ))}
          {!conversations.length && (
            <p className="px-2 py-6 text-center text-sm text-muted">{t.student.aiEmpty}</p>
          )}
        </div>
      </aside>

      <div className="flex min-h-[60vh] flex-1 flex-col rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <PageHeader
            title={t.student.aiPageTitle}
            description={t.student.aiPageHint}
          />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!messages.length && (
            <Card className="space-y-3 border-dashed">
              <p className="text-center text-muted">{t.student.aiEmpty}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void sendAiTeacherLesson()}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25"
                >
                  {locale === "ar"
                    ? "ابدأ فصل المعلم AI (سبورة + صوت)"
                    : locale === "tr"
                      ? "AI Tahta Sınıfını Başlat"
                      : locale === "ku"
                        ? "پۆلی مامۆستای AI دەستپێبکە"
                        : "Start AI Teacher classroom (board + voice)"}
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendChat(p)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-white/5"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Card>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div className="max-w-[92%] space-y-2">
                {m.text ? (
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-accent/20 text-foreground"
                        : "bg-white/5 text-foreground"
                    )}
                  >
                    {m.text}
                  </div>
                ) : null}
                {m.aiTeacherLesson ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        reopenClassroomFromLesson(m.aiTeacherLesson!)
                      }
                      className="w-full rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-left hover:bg-emerald-500/25"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                        U Learn ·{" "}
                        {locale === "ar" ? "الفصل المباشر" : "Live classroom"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {m.aiTeacherLesson.lesson_title}
                      </p>
                      <p className="mt-1 text-xs text-emerald-100/80">
                        {locale === "ar"
                          ? "اضغط لبدء جلسة فصل مباشرة جديدة"
                          : "Tap to start a new live classroom session"}
                      </p>
                    </button>
                  </div>
                ) : null}
                {m.selectableMaterials && m.selectableMaterials.length > 0 ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <p className="mb-2 text-xs font-semibold text-emerald-200">
                      {locale === "ar"
                        ? "اختر المادة لبدء الفصل المباشر"
                        : "Choose a material to start the live classroom"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {m.selectableMaterials.map((mat) => (
                        <button
                          key={mat.id}
                          type="button"
                          disabled={sending}
                          onClick={() =>
                            void continueWithMaterial({
                              documentId: mat.id,
                              mode: m.pendingMode || "ai_teacher",
                              question: m.pendingQuestion,
                            })
                          }
                          className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          {mat.fileName}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {m.file ? (
                  <div className="space-y-2">
                    {(m.file.mimeType || "").startsWith("image/") ||
                    /\.(png|jpe?g|gif|webp|svg)$/i.test(m.file.fileName) ? (
                      <GeneratedChatImage file={m.file} />
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void downloadChatFile(m.file!)}
                    >
                      Download {m.file.fileName}
                    </Button>
                  </div>
                ) : null}
                {m.exam ? (
                  <ExamPanel
                    exam={m.exam}
                    disabled={Boolean(m.examDone)}
                    submitLabel={t.student.aiSubmitExam}
                    onSubmit={(answers, elapsed, expired) =>
                      submitExam(m.id, m.exam!, answers, elapsed, expired)
                    }
                  />
                ) : null}
                {m.result ? <ResultPanel result={m.result} /> : null}
              </div>
            </div>
          ))}
          {sending && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100/90">
              {preparingClassroom
                ? locale === "ar"
                  ? "جارٍ تجهيز الفصل المباشر والسبورة…"
                  : locale === "tr"
                    ? "Canlı sınıf ve tahta hazırlanıyor…"
                    : "Preparing live classroom & board…"
                : t.student.aiThinking}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={openExamPicker} disabled={sending}>
              {t.student.aiGenerateExam}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => void sendAiTeacherLesson()}
              className="border-violet-500/40 text-violet-200 hover:bg-violet-500/10"
            >
              {locale === "ar"
                ? "معلم السبورة AI"
                : locale === "tr"
                  ? "AI Tahta Öğretmeni"
                  : locale === "ku"
                    ? "مامۆستای تەختەی AI"
                    : "AI Teacher (board)"}
            </Button>
            <label className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm hover:bg-white/5">
              Attach
              <input
                type="file"
                className="hidden"
                multiple
                accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp,.docx,.txt"
                onChange={(e) => {
                  const next = Array.from(e.target.files || []);
                  setPendingFiles((prev) => [...prev, ...next].slice(0, 8));
                  e.target.value = "";
                }}
              />
            </label>
            {pendingFiles.map((f) => (
              <span key={f.name + f.size} className="text-xs text-muted">
                {f.name}
                <button
                  type="button"
                  className="ml-1 underline"
                  onClick={() =>
                    setPendingFiles((prev) => prev.filter((x) => x !== f))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachmentPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={sending}
                  onClick={() => void sendChat(p)}
                  className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          {!pendingFiles.length && messages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {quickPrompts.slice(0, 2).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={sending}
                  onClick={() => void sendChat(p)}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:bg-white/5"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendChat();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.student.aiPlaceholder}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <Button type="submit" disabled={sending || (!input.trim() && !pendingFiles.length)}>
              {t.student.aiSend}
            </Button>
          </form>
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden p-0">
            <div className="border-b border-border p-4">
              <h3 className="font-semibold">{t.student.aiPickMaterials}</h3>
              <p className="mt-1 text-sm text-muted">{t.student.aiPickMaterialsHint}</p>
              {pickerMode === "exam" && (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t.student.aiExamDifficulty}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        { count: 5 as const, label: t.student.aiExamBasic },
                        { count: 10 as const, label: t.student.aiExamIntermediate },
                        { count: 20 as const, label: t.student.aiExamAdvanced },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.count}
                        type="button"
                        onClick={() => setExamCount(opt.count)}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-sm font-medium transition",
                          examCount === opt.count
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-border text-muted hover:border-accent/40"
                        )}
                      >
                        {opt.label}
                        <span className="ms-1 text-xs opacity-80">({opt.count})</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="max-h-[50vh] space-y-1 overflow-y-auto p-3">
              {docs.map((d) => {
                const checked = selectedDocs.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedDocs((prev) =>
                          checked ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                        )
                      }
                    />
                    <span className="text-sm">{d.fileName}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-3">
              <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                disabled={!selectedDocs.length || sending}
                onClick={() => void confirmMaterialPicker()}
              >
                {pickerMode === "exam"
                  ? t.student.aiGenerateExam
                  : pickerMode === "ai_teacher"
                    ? locale === "ar"
                      ? "ابدأ درس المعلم الصوتي"
                      : locale === "tr"
                        ? "Sesli tahta dersini başlat"
                        : "Start voice board lesson"
                    : locale === "ar"
                      ? "شرح مع رسم الأشكال"
                      : locale === "tr"
                        ? "Şekillerle açıkla"
                        : "Explain with shapes"}
              </Button>
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}

function GeneratedChatImage({
  file,
}: {
  file: NonNullable<ChatMsg["file"]>;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      try {
        if (file.contentBase64) {
          const bin = atob(file.contentBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], {
            type: file.mimeType || "image/png",
          });
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setSrc(objectUrl);
          return;
        }
        if (file.downloadUrl) {
          const res = await fetch(file.downloadUrl);
          if (!res.ok) return;
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setSrc(objectUrl);
        }
      } catch {
        /* preview is best-effort */
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.contentBase64, file.downloadUrl, file.mimeType]);

  if (!src) {
    return (
      <div className="rounded-xl border border-border bg-white/5 px-3 py-8 text-center text-xs text-muted">
        Loading image preview…
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={file.fileName}
      className="max-h-80 w-full rounded-xl border border-border object-contain bg-black/20"
    />
  );
}

function ExamPanel({
  exam,
  disabled,
  submitLabel,
  onSubmit,
}: {
  exam: PracticeExam;
  disabled: boolean;
  submitLabel: string;
  onSubmit: (answers: Record<string, string>, elapsed: number, expired: boolean) => Promise<void>;
}) {
  const [remaining, setRemaining] = useState(exam.timeLimitSec);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(disabled);
  const started = useRef(Date.now());
  const finishing = useRef(false);
  const answersRef = useRef(answers);
  const onSubmitRef = useRef(onSubmit);
  answersRef.current = answers;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          if (!finishing.current) {
            finishing.current = true;
            void (async () => {
              setBusy(true);
              setDone(true);
              try {
                const elapsed = Math.floor((Date.now() - started.current) / 1000);
                await onSubmitRef.current(answersRef.current, elapsed, true);
              } finally {
                setBusy(false);
              }
            })();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [done]);

  async function finish(expired: boolean) {
    if (busy || done || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setDone(true);
    try {
      const elapsed = Math.floor((Date.now() - started.current) / 1000);
      await onSubmit(answers, elapsed, expired);
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-semibold">{exam.title}</h4>
        <span className={cn("rounded-full px-3 py-1 text-xs font-bold", remaining <= 30 && "text-red-400")}>
          {mm}:{ss}
        </span>
      </div>
      <div className="space-y-4">
        {exam.questions.map((q, i) => (
          <div key={i}>
            <p className="mb-2 text-sm font-medium">
              {i + 1}. {q.text}
            </p>
            {q.imageBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${q.imageBase64}`}
                alt=""
                className="mb-2 max-h-56 w-full rounded-xl border border-border object-contain bg-black/20"
              />
            ) : null}
            <div className="space-y-1">
              {Object.entries(q.options || {}).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  disabled={done}
                  onClick={() => setAnswers((a) => ({ ...a, [String(i)]: k }))}
                  className={cn(
                    "block w-full rounded-xl border px-3 py-2 text-left text-sm",
                    answers[String(i)] === k
                      ? "border-accent bg-accent/15"
                      : "border-border hover:bg-white/5"
                  )}
                >
                  {k}. {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!done && (
        <Button className="mt-4 w-full" disabled={busy} onClick={() => void finish(false)}>
          {submitLabel}
        </Button>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: ExamResult }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        result.passed ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold">{result.passed ? "Passed" : "Needs review"}</p>
        <p className="text-2xl font-extrabold">{result.percentage}%</p>
      </div>
      <p className="mt-1 text-sm text-muted">
        Score {result.score}/{result.maxScore}
      </p>
      {result.analysis ? <p className="mt-3 text-sm leading-relaxed">{result.analysis}</p> : null}
      {result.review?.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {result.review.slice(0, 8).map((r, i) => (
            <li key={i} className="flex gap-2">
              <span>{r.isCorrect ? "✓" : "✗"}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
