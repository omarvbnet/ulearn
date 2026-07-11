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
    courseId?: string | null;
    /** App UI language: en | ar | ku | tr */
    language?: string | null;
    lesson?: string | null;
    attachments?: ChatAttachmentInput[];
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
        studentProfile: {
          select: {
            educationalStageId: true,
            grade: true,
            educationalStage: {
              select: { nameEn: true, nameAr: true, nameKu: true, nameTr: true },
            },
          },
        },
      },
    });

    const language = normalizeLang(input.language || profile?.locale);
    const stageId =
      input.stageId ?? profile?.studentProfile?.educationalStageId ?? null;
    const studentName = profile?.fullLegalName?.trim() || null;
    const stage = profile?.studentProfile?.educationalStage;
    const stageName = stage
      ? stageNameForLang(stage, language)
      : null;
    const grade = profile?.studentProfile?.grade || null;

    const unavailable = unavailableAnswer(language);
    const hasAttachments = attachments.length > 0;
    const processed = await processAttachments(attachments);

    // Skip response cache when attachments are present (unique visual/doc context).
    const norm = EmbeddingService.normalizeQuestion(question);
    const cacheKey = EmbeddingService.hashQuestion(
      `${norm}|${language}`,
      stageId,
      input.subjectId
    );

    if (!hasAttachments) {
      const cached = await prisma.aiResponseCache.findUnique({ where: { cacheKey } });
      if (cached && (!cached.expiresAt || cached.expiresAt > new Date())) {
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

    const qEmbed = await EmbeddingService.embedText(
      [question, processed.textExcerpt].filter(Boolean).join("\n").slice(0, 8000),
      input.userId
    );

    if (!hasAttachments) {
      const nearCaches = await prisma.aiResponseCache.findMany({
        where: {
          stageId: stageId ?? undefined,
          subjectId: input.subjectId ?? undefined,
          expiresAt: { gt: new Date() },
        },
        take: 40,
        orderBy: { createdAt: "desc" },
      });
      for (const c of nearCaches) {
        if (!c.embedding?.length) continue;
        if (EmbeddingService.cosineSimilarity(qEmbed, c.embedding) >= 0.96) {
          await prisma.aiResponseCache.update({
            where: { id: c.id },
            data: { hitCount: { increment: 1 } },
          });
          return this.persistTurn({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            answer: c.answer,
            citations: c.citations,
            fromCache: true,
            attachmentNames: [],
          });
        }
      }
    }

    // Prefer this student's stage materials first (never other stages).
    const hits = await VectorSearchService.search(qEmbed, {
      educationalStageId: stageId,
      subjectId: input.subjectId,
      courseId: input.courseId,
      lesson: input.lesson,
      topK: TOP_K,
      minSimilarity: MIN_SIMILARITY,
      preferLanguage: language,
      stageStrict: true,
    });

    const best = hits[0]?.similarity ?? 0;
    if (!hits.length && !hasAttachments) {
      const readyForStage = stageId
        ? await prisma.kbDocument.count({
            where: {
              status: "READY",
              deletedAt: null,
              OR: [{ educationalStageId: stageId }, { educationalStageId: null }],
            },
          })
        : await prisma.kbDocument.count({
            where: { status: "READY", deletedAt: null },
          });
      const emptyKb = readyForStage === 0;
      return this.persistTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        answer: emptyKb ? emptyKnowledgeBaseAnswer(language) : unavailable,
        citations: [],
        fromCache: false,
        attachmentNames: [],
      });
    }

    const context = hits.length ? compressContext(hits) : "";
    const memoryBlurb = StudentMemoryService.toPromptBlurb(memory);
    const studentBlurb = [
      studentName ? `Student name: ${studentName}` : null,
      stageName ? `Educational stage: ${stageName}` : null,
      grade ? `Grade: ${grade}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    const system = [
      "You are U Learn Teaching Assistant.",
      languageInstruction(language),
      studentBlurb ? `Know this student: ${studentBlurb}. Address them by name when natural.` : "",
      memoryBlurb ? `Learning memory: ${memoryBlurb}` : "",
      hasAttachments
        ? "The student attached files/photos. Use them to understand the question (homework photo, worksheet, PDF notes)."
        : "",
      context
        ? "For curriculum facts, answer ONLY using the retrieved educational material below (plus the attachments when relevant)."
        : "No matching curriculum chunks were retrieved. If attachments are present, help with those; otherwise say the unavailable line.",
      "If you cannot answer from retrieved material or attachments, reply exactly with this unavailable message (same language):",
      unavailable,
      "Do not invent curriculum facts outside retrieved material + attachments.",
      "Keep answers clear and educational. Cite document names/pages when helpful.",
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
    let answer = result.text.trim() || unavailable;

    if (
      !hasAttachments &&
      /i (don't|do not) have|not in (the )?(context|material)/i.test(answer) &&
      best < 0.65
    ) {
      answer = unavailable;
    }

    const citations = hits.slice(0, 6).map((h) => ({
      documentName: h.fileName,
      page: h.pageNumber,
      similarity: Math.round(h.similarity * 1000) / 1000,
    }));

    if (!hasAttachments) {
      await prisma.aiResponseCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          questionNorm: norm,
          stageId,
          subjectId: input.subjectId ?? null,
          answer,
          citations,
          embedding: qEmbed,
          expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        },
        update: {
          answer,
          citations,
          embedding: qEmbed,
          expiresAt: new Date(Date.now() + CACHE_TTL_MS),
          hitCount: { increment: 1 },
        },
      });
    }

    void StudentMemoryService.recordQuestion(input.userId, question, input.subjectId);

    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question: attachmentAwareQuestionLabel(question, attachments),
      answer,
      citations,
      fromCache: false,
      attachmentNames: attachments.map((a) => a.fileName),
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

function emptyKnowledgeBaseAnswer(language?: string | null): string {
  const lang = normalizeLang(language);
  switch (lang) {
    case "ar":
      return "قاعدة المعرفة فارغة أو ما زالت قيد المعالجة. اطلب من المسؤول رفع المواد التعليمية وإعادة معالجتها.";
    case "ku":
      return "بنکەی زانیاری بەتاڵە یان هێشتا لە پرۆسەدایە. داوا لە بەڕێوەبەر بکە ماددە فێرکارییەکان بار بکات و دووبارە پرۆسێس بکات.";
    case "tr":
      return "Bilgi tabanı boş veya hâlâ işleniyor. Yöneticiden eğitim materyallerini yüklemesini ve yeniden işlemesini isteyin.";
    default:
      return "The knowledge base is empty or still processing. Ask an admin to upload educational materials and reprocess them.";
  }
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
