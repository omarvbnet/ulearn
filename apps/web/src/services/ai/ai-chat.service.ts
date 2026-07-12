import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { EmbeddingService } from "./embedding.service";
import { VectorSearchService, type RetrievedChunk } from "./vector-search.service";
import { StudentMemoryService } from "./student-memory.service";
import { extractTextFromBuffer } from "./text-extract";
import {
  languageInstruction,
  unavailableAnswer,
  type ChatAttachmentInput,
  type ChatContentPart,
  type ChatMessage,
} from "./types";

const TOP_K = 10;
/** Soft floor — too high (0.58+) rejects valid Arabic/cross-lang matches. */
const MIN_SIMILARITY = 0.42;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;

export class AiChatService {
  static async listConversations(userId: string) {
    return prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
  }

  static async getConversation(userId: string, id: string) {
    return prisma.aiConversation.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  static async chat(input: {
    userId: string;
    question: string;
    conversationId?: string;
    stageId?: string | null;
    subjectId?: string | null;
    /** Prefer these subjects (certificate interests). */
    subjectIds?: string[];
    courseId?: string | null;
    /** App UI language: en | ar | ku | tr */
    language?: string | null;
    lesson?: string | null;
    attachments?: ChatAttachmentInput[];
    /** chat | practice_quiz | edit (edit also auto-detected from question + attachments). */
    mode?: "chat" | "practice_quiz" | "edit";
    /** KB document ids for practice quiz material selection. */
    documentIds?: string[];
  }) {
    const attachments = (input.attachments || []).slice(0, MAX_ATTACHMENTS);
    for (const a of attachments) {
      const approx = Math.ceil((a.dataBase64.length * 3) / 4);
      if (approx > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Attachment too large: ${a.fileName} (max 4MB)`);
      }
    }

    const question =
      input.question.trim() ||
      (attachments.length
        ? "Please explain the attached file(s) and help me understand them in the context of my studies."
        : "");
    if (!question) throw new Error("Question is required");

    const memory = await StudentMemoryService.getOrCreate(input.userId);
    const profile = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        fullLegalName: true,
        locale: true,
        role: true,
        studentProfile: {
          select: {
            educationalStageId: true,
            grade: true,
            educationalStage: {
              select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true },
            },
          },
        },
        certificateProfile: {
          select: {
            interests: {
              include: {
                subject: {
                  select: {
                    id: true,
                    nameEn: true,
                    nameAr: true,
                    nameKu: true,
                    nameTr: true,
                    stageId: true,
                    stage: {
                      select: {
                        id: true,
                        nameEn: true,
                        nameAr: true,
                        nameKu: true,
                        nameTr: true,
                        isCertificateTrack: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const language = normalizeLang(input.language || profile?.locale);
    const isCert = profile?.role === "CERTIFICATE_USER";
    const interestSubjects =
      profile?.certificateProfile?.interests.map((i) => i.subject) ?? [];
    const interestIds = interestSubjects.map((s) => s.id);
    const certStage = interestSubjects.find((s) => s.stage)?.stage ?? null;

    let stageId =
      input.stageId ??
      (isCert
        ? certStage?.id ?? null
        : profile?.studentProfile?.educationalStageId ?? null);
    let subjectId = input.subjectId ?? null;
    let subjectIds =
      input.subjectIds?.length
        ? input.subjectIds
        : isCert && interestIds.length
          ? interestIds
          : undefined;
    if (isCert && subjectId && interestIds.length && !interestIds.includes(subjectId)) {
      subjectId = null;
    }
    if (isCert && !stageId && certStage) stageId = certStage.id;

    const studentName = profile?.fullLegalName?.trim() || null;
    const stage = isCert
      ? certStage
      : profile?.studentProfile?.educationalStage;
    const stageName = stage ? stageNameForLang(stage, language) : null;
    const grade = profile?.studentProfile?.grade || null;
    const interestNames = interestSubjects
      .map((s) => stageNameForLang(s, language))
      .filter(Boolean);

    const unavailable = unavailableAnswer(language);
    const hasAttachments = attachments.length > 0;
    const processed = await processAttachments(attachments);
    const editIntent =
      input.mode === "edit" ||
      (hasAttachments && wantsAttachmentEdit(question));
    const practiceQuiz = input.mode === "practice_quiz";

    if (practiceQuiz) {
      const { ExamGeneratorService } = await import("./exam-generator.service");
      const quiz = await ExamGeneratorService.generatePractice({
        userId: input.userId,
        question,
        language,
        educationalStageId: stageId,
        subjectIds: subjectId ? [subjectId] : subjectIds,
        documentIds: input.documentIds,
        attachmentText: processed.textExcerpt,
      });
      return this.persistTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        answer: formatPracticeQuizAnswer(quiz, language),
        citations: quiz.citations,
        fromCache: false,
        attachmentNames: attachments.map((a) => a.fileName),
        practiceQuiz: quiz,
      });
    }

    // Skip response cache when attachments are present (unique visual/doc context).
    const norm = EmbeddingService.normalizeQuestion(question);
    const cacheKey = EmbeddingService.hashQuestion(
      `${norm}|${language}|${editIntent ? "edit" : "chat"}`,
      stageId,
      subjectId || subjectIds?.slice().sort().join(",") || null
    );

    if (!hasAttachments && !editIntent) {
      const cached = await prisma.aiResponseCache.findUnique({ where: { cacheKey } });
      if (cached && (!cached.expiresAt || cached.expiresAt > new Date())) {
        // Don't replay hard-unavailable cache forever — allow a fresh model pass.
        const cachedText = String(cached.answer || "");
        const isHardUnavail =
          cachedText === unavailable ||
          cachedText.includes("غير متوفرة في المواد") ||
          cachedText.includes("not available in the educational material");
        if (!isHardUnavail) {
          await prisma.aiResponseCache.update({
            where: { id: cached.id },
            data: { hitCount: { increment: 1 } },
          });
          return this.persistTurn({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            answer: cached.answer,
            citations: cached.citations,
            fromCache: true,
            attachmentNames: [],
          });
        }
      }
    }

    let qEmbed: number[] | null = null;
    let embedFailed = false;
    try {
      qEmbed = await EmbeddingService.embedText(
        [question, processed.textExcerpt].filter(Boolean).join("\n").slice(0, 8000),
        input.userId
      );
    } catch (e) {
      // Embeddings may be misconfigured; DeepSeek/chat should still answer.
      embedFailed = true;
      console.warn(
        "[ai/chat] embedding failed — continuing without RAG",
        e instanceof Error ? e.message : e
      );
    }

    // Prefer this student's stage / certificate interest materials first.
    const hits = qEmbed
      ? await VectorSearchService.search(qEmbed, {
          educationalStageId: stageId,
          subjectId: subjectId,
          subjectIds: subjectId ? undefined : subjectIds,
          subjectStrict: Boolean(isCert && (subjectIds?.length || subjectId)),
          courseId: input.courseId,
          lesson: input.lesson,
          topK: TOP_K,
          minSimilarity: MIN_SIMILARITY,
          preferLanguage: language,
          stageStrict: true,
        })
      : [];

    const best = hits[0]?.similarity ?? 0;
    const readyForStage = stageId
      ? await prisma.kbDocument.count({
          where: {
            status: "READY",
            deletedAt: null,
            educationalStageId: stageId,
            ...(isCert && interestIds.length
              ? { subjectId: { in: interestIds } }
              : {}),
          },
        })
      : await prisma.kbDocument.count({
          where: { status: "READY", deletedAt: null },
        });

    const context = hits.length ? compressContext(hits) : "";
    const memoryBlurb = StudentMemoryService.toPromptBlurb(memory);
    const studentBlurb = [
      studentName ? `Student name: ${studentName}` : null,
      stageName
        ? isCert
          ? `Professional track: ${stageName}`
          : `Educational stage: ${stageName}`
        : null,
      interestNames.length ? `Areas of interest: ${interestNames.join(", ")}` : null,
      grade ? `Grade: ${grade}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    const noCurriculumHits = !hits.length && !hasAttachments;
    const system = editIntent
      ? [
          "You are U Learn document editor assistant.",
          languageInstruction(language),
          "The user attached a file and asked you to edit it.",
          "Apply the requested edits to the attachment content (correct, rewrite, improve, restructure as asked).",
          "Respond with a short note of what you changed, then the FULL revised document text inside a single markdown fence marked as text:",
          "```text",
          "...full revised content...",
          "```",
          "Do not invent unrelated curriculum. Stay faithful to the attachment unless the user asked to expand.",
          processed.textExcerpt
            ? `\nOriginal extracted text:\n${processed.textExcerpt}`
            : "Original content is in the attached image(s) — transcribe and edit as requested.",
          context ? `\nOptional related curriculum context:\n${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "You are U Learn Teaching Assistant — a helpful tutor.",
          languageInstruction(language),
          studentBlurb
            ? `Know this student: ${studentBlurb}. Address them by name when natural.`
            : "",
          memoryBlurb ? `Learning memory: ${memoryBlurb}` : "",
          hasAttachments
            ? "The student attached files/photos. Use them to understand the question (homework photo, worksheet, PDF notes). Prefer answering from the attachment when the question is about it."
            : "",
          isCert
            ? "Prefer the student's areas of interest when giving examples."
            : "",
          context
            ? "For curriculum facts, prioritize the retrieved educational material below (plus attachments when relevant). Cite document names/pages when helpful."
            : noCurriculumHits
              ? [
                  readyForStage === 0
                    ? "No READY knowledge-base materials are uploaded for this student's stage/interests yet."
                    : "No closely matching chunks were retrieved for this question (retrieval may be weak).",
                  embedFailed
                    ? "Note: embedding/retrieval is currently degraded — answer as a general tutor."
                    : "",
                  "Still help the student: explain concepts, give study tips, and work through problems step by step.",
                  "Clearly say when your answer is general tutoring and not quoted from U Learn uploaded materials.",
                  "Do NOT invent that a specific uploaded PDF/page says something it does not.",
                ]
                  .filter(Boolean)
                  .join(" ")
              : "",
          "Keep answers clear and educational.",
          context ? `\nRetrieved material:\n${context}` : "",
          processed.textExcerpt
            ? `\nExtracted text from attached documents:\n${processed.textExcerpt}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

    const history = input.conversationId
      ? await prisma.aiMessage.findMany({
          where: { conversationId: input.conversationId },
          orderBy: { createdAt: "desc" },
          take: 6,
        })
      : [];

    const userParts: ChatContentPart[] = [...processed.imageParts];
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.reverse().map((m) => ({
        role: (m.role === "ASSISTANT" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      })),
      {
        role: "user",
        content: question,
        parts: userParts.length ? userParts : undefined,
      },
    ];

    const result = await AiProviderService.chat("TEACHING_ASSISTANT", messages, input.userId);
    let answer = result.text.trim();
    if (!answer) {
      answer = embedFailed
        ? language === "ar"
          ? "تعذر توليد إجابة الآن. تحقق من مزود الدردشة أو أعد المحاولة."
          : "Could not generate an answer right now. Check the chat provider or try again."
        : unavailable;
    }
    let editedFile:
      | { fileName: string; mimeType: string; contentBase64: string }
      | undefined;

    if (editIntent) {
      const extracted = extractFencedText(answer);
      if (extracted) {
        const baseName =
          attachments[0]?.fileName?.replace(/\.[^.]+$/, "") || "edited";
        const body = extracted;
        editedFile = {
          fileName: `${baseName}-edited.txt`,
          mimeType: "text/plain;charset=utf-8",
          contentBase64: Buffer.from(body, "utf8").toString("base64"),
        };
      }
    }

    // Only force the unavailable line when we had strong retrieval but the model refused.
    if (
      !hasAttachments &&
      !editIntent &&
      hits.length > 0 &&
      best >= 0.65 &&
      /i (don't|do not) have|not in (the )?(context|material)/i.test(answer)
    ) {
      answer = unavailable;
    }

    const citations = hits.slice(0, 6).map((h) => ({
      documentName: h.fileName,
      page: h.pageNumber,
      similarity: Math.round(h.similarity * 1000) / 1000,
    }));

    if (!hasAttachments && !editIntent && !embedFailed) {
      await prisma.aiResponseCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          questionNorm: norm,
          stageId,
          subjectId: subjectId ?? null,
          answer,
          citations,
          embedding: qEmbed || [],
          expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        },
        update: {
          answer,
          citations,
          embedding: qEmbed || [],
          expiresAt: new Date(Date.now() + CACHE_TTL_MS),
          hitCount: { increment: 1 },
        },
      });
    }

    void StudentMemoryService.recordQuestion(input.userId, question, subjectId);

    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question: attachmentAwareQuestionLabel(question, attachments),
      answer,
      citations,
      fromCache: false,
      attachmentNames: attachments.map((a) => a.fileName),
      editedFile,
    });
  }

  private static async persistTurn(input: {
    userId: string;
    conversationId?: string;
    question: string;
    answer: string;
    citations: unknown;
    fromCache: boolean;
    attachmentNames: string[];
    editedFile?: { fileName: string; mimeType: string; contentBase64: string };
    practiceQuiz?: unknown;
  }) {
    let conversationId = input.conversationId;
    if (!conversationId) {
      const conv = await prisma.aiConversation.create({
        data: {
          userId: input.userId,
          title: input.question.slice(0, 80),
        },
      });
      conversationId = conv.id;
    } else {
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    }

    await prisma.aiMessage.create({
      data: {
        conversationId,
        userId: input.userId,
        role: "USER",
        content: input.question,
        citations:
          input.attachmentNames.length
            ? ({ attachments: input.attachmentNames } as never)
            : undefined,
      },
    });

    const assistant = await prisma.aiMessage.create({
      data: {
        conversationId,
        userId: input.userId,
        role: "ASSISTANT",
        content: input.answer,
        citations: input.citations as never,
      },
    });

    return {
      conversationId,
      messageId: assistant.id,
      answer: input.answer,
      citations: input.citations,
      fromCache: input.fromCache,
      editedFile: input.editedFile,
      practiceQuiz: input.practiceQuiz,
    };
  }
}

function normalizeLang(raw?: string | null): string {
  const v = (raw || "en").toLowerCase();
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("ku") || v.startsWith("ckb")) return "ku";
  if (v.startsWith("tr")) return "tr";
  if (v.startsWith("en")) return "en";
  return v.slice(0, 2) || "en";
}

function stageNameForLang(
  stage: { nameEn: string; nameAr: string; nameKu: string; nameTr: string },
  lang: string
) {
  const name =
    lang === "ar"
      ? stage.nameAr
      : lang === "ku"
        ? stage.nameKu
        : lang === "tr"
          ? stage.nameTr
          : stage.nameEn;
  return name || stage.nameEn;
}

function attachmentAwareQuestionLabel(question: string, attachments: ChatAttachmentInput[]) {
  if (!attachments.length) return question;
  const names = attachments.map((a) => a.fileName).join(", ");
  return `${question}\n[attachments: ${names}]`;
}

async function processAttachments(attachments: ChatAttachmentInput[]): Promise<{
  imageParts: ChatContentPart[];
  textExcerpt: string;
}> {
  const imageParts: ChatContentPart[] = [];
  const texts: string[] = [];

  for (const a of attachments) {
    const mime = (a.mimeType || "").toLowerCase();
    const name = a.fileName || "file";
    const raw = a.dataBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(raw, "base64");

    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name)) {
      imageParts.push({
        type: "image",
        mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
        dataBase64: raw,
      });
      continue;
    }

    try {
      const extracted = await extractTextFromBuffer(buffer, mime, name);
      if (extracted.text?.trim()) {
        texts.push(`[${name}]\n${extracted.text.trim().slice(0, 12000)}`);
      }
    } catch {
      texts.push(`[${name}] (could not extract text — unsupported or binary)`);
    }
  }

  return {
    imageParts,
    textExcerpt: texts.join("\n\n---\n\n").slice(0, 20000),
  };
}

function compressContext(hits: RetrievedChunk[]): string {
  const maxChars = 9000;
  let used = 0;
  const parts: string[] = [];
  for (const h of hits) {
    const header = `[${h.fileName}${h.pageNumber ? ` p.${h.pageNumber}` : ""} | sim=${h.similarity.toFixed(2)}]`;
    const body = h.text.length > 900 ? `${h.text.slice(0, 900)}…` : h.text;
    const block = `${header}\n${body}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n\n---\n\n");
}

function wantsAttachmentEdit(question: string): boolean {
  return /\b(edit|correct|rewrite|fix|improve|revise|proofread|update|change|تعديل|صحح|أعد|اصلح|حسّن|حسن)\b/i.test(
    question
  );
}

function extractFencedText(answer: string): string | null {
  const m = answer.match(/```(?:text|txt|markdown|md)?\s*([\s\S]*?)```/i);
  if (m?.[1]?.trim()) return m[1].trim();
  return null;
}

function formatPracticeQuizAnswer(
  quiz: {
    title: string;
    questions: Array<{ text: string; options: Record<string, string>; correctKey: string }>;
  },
  language: string
): string {
  const header =
    language === "ar"
      ? "اختبار تدريبي"
      : language === "ku"
        ? "تاقیکردنەوەی ڕاهێنان"
        : language === "tr"
          ? "Alıştırma sınavı"
          : "Practice quiz";
  const lines = [`${header}: ${quiz.title}`, ""];
  quiz.questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.text}`);
    for (const [k, v] of Object.entries(q.options)) {
      lines.push(`   ${k}) ${v}`);
    }
    lines.push("");
  });
  lines.push(
    language === "ar"
      ? "(الإجابات الصحيحة محفوظة للتقييم داخل التطبيق.)"
      : "(Correct answers are kept for in-app scoring.)"
  );
  return lines.join("\n");
}
