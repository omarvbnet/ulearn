import { prisma } from "@/lib/prisma";
import { AiProviderService } from "../ai-provider.service";
import { EmbeddingService } from "../embedding.service";
import { VectorSearchService } from "../vector-search.service";
import { languageInstruction, type ChatMessage } from "../types";
import { LoggingService } from "@/services/logging.service";

function normalizeLang(raw?: string | null): string {
  const v = (raw || "en").toLowerCase();
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("ku")) return "ku";
  if (v.startsWith("tr")) return "tr";
  return "en";
}

export class ProfessorChatService {
  static async chat(input: {
    instructorId: string;
    question: string;
    language?: string | null;
    documentIds?: string[];
    courseId?: string | null;
    conversationId?: string;
    stream?: boolean;
  }) {
    const question = input.question.trim();
    if (!question) throw new Error("Question is required");

    const language = normalizeLang(input.language);
    const embedding = await EmbeddingService.embedText(question, input.instructorId);

    const chunks = await VectorSearchService.search(embedding, {
      instructorId: input.instructorId,
      documentIds: input.documentIds?.length ? input.documentIds : undefined,
      courseId: input.courseId,
      preferLanguage: language,
      topK: 10,
      minSimilarity: 0.35,
      stageStrict: false,
    });

    const context = chunks
      .map(
        (c, i) =>
          `[${i + 1}] ${c.fileName}${c.pageNumber != null ? ` p.${c.pageNumber}` : ""}\n${c.text}`
      )
      .join("\n\n");

    const system: ChatMessage = {
      role: "system",
      content: [
        "You are AI Professor Studio — a private teaching assistant for this instructor.",
        "Answer ONLY using the provided document excerpts when they are relevant.",
        "If the excerpts do not contain the answer, say so clearly and suggest what to upload.",
        "Cite sources as [n] when using excerpts.",
        languageInstruction(language),
        context
          ? `Document excerpts:\n${context}`
          : "No retrieved document excerpts. Ask the teacher to upload or select materials.",
      ].join("\n\n"),
    };

    let conversationId = input.conversationId;
    if (!conversationId) {
      const conv = await prisma.aiConversation.create({
        data: {
          userId: input.instructorId,
          title: question.slice(0, 80),
        },
      });
      conversationId = conv.id;
    }

    await prisma.aiMessage.create({
      data: {
        conversationId,
        userId: input.instructorId,
        role: "USER",
        content: question,
      },
    });

    const history = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const messages: ChatMessage[] = [
      system,
      ...history.map((m) => ({
        role: (m.role === "ASSISTANT" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      })),
    ];

    const moduleKey =
      (await AiProviderService.resolveProvider("PROFESSOR_DOCUMENT")) != null
        ? "PROFESSOR_DOCUMENT"
        : "TEACHING_ASSISTANT";

    const result = await AiProviderService.chat(moduleKey, messages, input.instructorId);
    const answer = result.text || "I could not generate a response.";

    await prisma.aiMessage.create({
      data: {
        conversationId,
        userId: input.instructorId,
        role: "ASSISTANT",
        content: answer,
        citations: chunks.map((c) => ({
          documentId: c.documentId,
          fileName: c.fileName,
          pageNumber: c.pageNumber,
          similarity: c.similarity,
        })),
      },
    });

    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    void LoggingService.log({
      actorId: input.instructorId,
      action: "PROFESSOR_CHAT",
      entityType: "AiConversation",
      entityId: conversationId,
      newValue: { documentIds: input.documentIds, chunkCount: chunks.length },
    });

    return {
      conversationId,
      answer,
      citations: chunks.map((c) => ({
        documentId: c.documentId,
        fileName: c.fileName,
        pageNumber: c.pageNumber,
        similarity: c.similarity,
      })),
    };
  }

  /** SSE stream: sends {type:'token'|'done'|'error', ...} events. */
  static async chatStream(
    input: {
      instructorId: string;
      question: string;
      language?: string | null;
      documentIds?: string[];
      courseId?: string | null;
      conversationId?: string;
    },
    onEvent: (event: Record<string, unknown>) => void
  ) {
    // Providers may not support true token streaming uniformly — do full chat then emit.
    try {
      const result = await this.chat(input);
      const words = result.answer.split(/(\s+)/);
      let acc = "";
      for (const w of words) {
        acc += w;
        onEvent({ type: "token", text: w });
      }
      onEvent({
        type: "done",
        conversationId: result.conversationId,
        answer: acc || result.answer,
        citations: result.citations,
      });
    } catch (e) {
      onEvent({
        type: "error",
        message: e instanceof Error ? e.message : "Chat failed",
      });
    }
  }
}
