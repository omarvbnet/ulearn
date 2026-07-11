import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { EmbeddingService } from "./embedding.service";
import { VectorSearchService, type RetrievedChunk } from "./vector-search.service";
import { StudentMemoryService } from "./student-memory.service";
import { UNAVAILABLE_ANSWER } from "./types";

const TOP_K = 10;
const MIN_SIMILARITY = 0.58;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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
    language?: string | null;
    lesson?: string | null;
  }) {
    const question = input.question.trim();
    if (!question) throw new Error("Question is required");

    const memory = await StudentMemoryService.getOrCreate(input.userId);
    const profile = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        locale: true,
        studentProfile: { select: { educationalStageId: true } },
      },
    });

    const stageId = input.stageId ?? profile?.studentProfile?.educationalStageId ?? null;
    const language = input.language ?? profile?.locale?.toLowerCase() ?? null;
    const norm = EmbeddingService.normalizeQuestion(question);
    const cacheKey = EmbeddingService.hashQuestion(norm, stageId, input.subjectId);

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
      });
    }

    // Near-duplicate cache via embedding distance
    const qEmbed = await EmbeddingService.embedText(question, input.userId);
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
        });
      }
    }

    const hits = await VectorSearchService.search(qEmbed, {
      educationalStageId: stageId,
      subjectId: input.subjectId,
      courseId: input.courseId,
      language,
      lesson: input.lesson,
      topK: TOP_K,
      minSimilarity: MIN_SIMILARITY,
    });

    const best = hits[0]?.similarity ?? 0;
    if (!hits.length || best < MIN_SIMILARITY) {
      return this.persistTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        answer: UNAVAILABLE_ANSWER,
        citations: [],
        fromCache: false,
      });
    }

    const context = compressContext(hits);
    const memoryBlurb = StudentMemoryService.toPromptBlurb(memory);
    const system = [
      "You are U Learn Teaching Assistant.",
      "Answer ONLY using the retrieved educational material below.",
      "If the material does not contain the answer, reply exactly:",
      UNAVAILABLE_ANSWER,
      "Do not invent facts, formulas, or curriculum outside the context.",
      "Keep answers clear and educational. Cite document names/pages when helpful.",
      memoryBlurb ? `Student learning context: ${memoryBlurb}` : "",
      language ? `Prefer responding in locale/language: ${language}` : "",
      "",
      "Retrieved material:",
      context,
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

    const messages = [
      { role: "system" as const, content: system },
      ...history
        .reverse()
        .map((m) => ({
          role: (m.role === "ASSISTANT" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        })),
      { role: "user" as const, content: question },
    ];

    const result = await AiProviderService.chat("TEACHING_ASSISTANT", messages, input.userId);
    let answer = result.text.trim() || UNAVAILABLE_ANSWER;

    // Soft guard: if model drifts and hits were borderline, force unavailable.
    if (/i (don't|do not) have|not in (the )?(context|material)/i.test(answer) && best < 0.65) {
      answer = UNAVAILABLE_ANSWER;
    }

    const citations = hits.slice(0, 6).map((h) => ({
      documentName: h.fileName,
      page: h.pageNumber,
      similarity: Math.round(h.similarity * 1000) / 1000,
    }));

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

    void StudentMemoryService.recordQuestion(input.userId, question, input.subjectId);

    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question,
      answer,
      citations,
      fromCache: false,
    });
  }

  private static async persistTurn(input: {
    userId: string;
    conversationId?: string;
    question: string;
    answer: string;
    citations: unknown;
    fromCache: boolean;
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
