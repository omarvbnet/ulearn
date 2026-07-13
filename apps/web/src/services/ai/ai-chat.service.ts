import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";
import { EmbeddingService } from "./embedding.service";
import { VectorSearchService, type RetrievedChunk } from "./vector-search.service";
import { StudentMemoryService } from "./student-memory.service";
import { StudentLearningContextService } from "./student-learning-context.service";
import { extractTextFromBuffer } from "./text-extract";
import {
  buildTutoringMethodPrompt,
  extractFollowUps,
} from "./tutoring-prompt";
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
/** Uploaded-via-key documents can be larger (proxy-safe). */
const MAX_KEYED_ATTACHMENT_BYTES = 40 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

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
    /** chat | practice_quiz | edit | explain_observe */
    mode?: "chat" | "practice_quiz" | "edit" | "explain_observe";
    /** KB document ids for practice quiz / explain-observe material selection. */
    documentIds?: string[];
    /** Practice exam size: 5 | 10 | 20 */
    count?: 5 | 10 | 20;
  }) {
    const attachments = (input.attachments || []).slice(0, MAX_ATTACHMENTS);
    for (const a of attachments) {
      if (!a.dataBase64 && !a.fileKey && !a.fileUrl) {
        throw new Error(`Attachment missing data: ${a.fileName}`);
      }
      if (a.dataBase64) {
        const approx = Math.ceil((a.dataBase64.length * 3) / 4);
        if (approx > MAX_ATTACHMENT_BYTES) {
          throw new Error(
            `Attachment too large for inline upload: ${a.fileName} (max 4MB). Upload via file key instead.`
          );
        }
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

    // Creative Studio actions run inside chat (learners only) when the user asks
    // to merge / design / edit with or without attachments.
    const learnerCreative =
      profile?.role === "STUDENT" || profile?.role === "CERTIFICATE_USER";
    if (learnerCreative) {
      const { detectCreativeChatIntent } = await import("./creative/creative-intent");
      const creativeIntent = detectCreativeChatIntent(question, attachments);
      if (creativeIntent) {
        const creativeResult = await this.runCreativeInChat({
          userId: input.userId,
          conversationId: input.conversationId,
          question,
          language,
          attachments,
          intent: creativeIntent,
        });
        if (creativeResult) return creativeResult;
      }
    }

    const {
      detectExplainObserveIntent,
      materialSelectMessage,
    } = await import("./creative/figure-prompts");
    const explainObserve =
      input.mode === "explain_observe" ||
      (learnerCreative &&
        !attachments.length &&
        detectExplainObserveIntent(question));

    if (explainObserve && learnerCreative) {
      const hasDocs = Boolean(input.documentIds?.length);
      if (!hasDocs) {
        return {
          conversationId: input.conversationId || null,
          messageId: null,
          answer: materialSelectMessage(language),
          citations: [],
          fromCache: false,
          needsMaterialSelection: true,
          pendingMode: "explain_observe" as const,
          pendingQuestion: question,
        };
      }
      return this.runExplainObserveWithMaterials({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        language,
        documentIds: input.documentIds || [],
        stageId,
        subjectId,
        subjectIds,
      });
    }

    const processed = await processAttachments(attachments, input.userId);
    const editIntent =
      input.mode === "edit" ||
      (hasAttachments && wantsAttachmentEdit(question));
    const practiceQuiz = input.mode === "practice_quiz";

    if (practiceQuiz) {
      const { ExamGeneratorService } = await import("./exam-generator.service");
      const { AiExamService, stripCorrectKeys } = await import("./ai-exam.service");
      const documentIds = await AiExamService.assertDocumentsAllowed(
        input.userId,
        input.documentIds || []
      );
      const quiz = await ExamGeneratorService.generatePractice({
        userId: input.userId,
        question,
        language,
        educationalStageId: stageId,
        subjectIds: subjectId ? [subjectId] : subjectIds,
        documentIds,
        requireDocuments: true,
        count: input.count === 10 || input.count === 20 ? input.count : 5,
      });

      // Ensure conversation exists before linking the attempt.
      let conversationId = input.conversationId;
      if (!conversationId) {
        const conv = await prisma.aiConversation.create({
          data: {
            userId: input.userId,
            title: (quiz.title || question).slice(0, 80),
          },
        });
        conversationId = conv.id;
      }

      const attempt = await AiExamService.createAttempt({
        userId: input.userId,
        conversationId,
        documentIds,
        title: quiz.title,
        questions: quiz.questions,
      });

      const publicQuiz = {
        title: quiz.title,
        questions: stripCorrectKeys(quiz.questions),
        citations: quiz.citations,
        examAttemptId: attempt.id,
        timeLimitSec: attempt.timeLimitSec,
      };

      const intro =
        language === "ar"
          ? `امتحان جاهز: ${quiz.title}\nاختر الإجابات مباشرة. الوقت: ${attempt.timeLimitSec} ثانية.`
          : `Exam ready: ${quiz.title}\nSelect your answers below. Time limit: ${attempt.timeLimitSec}s.`;

      return this.persistTurn({
        userId: input.userId,
        conversationId,
        question: question || `Generate exam from ${documentIds.length} material(s)`,
        answer: intro,
        citations: quiz.citations,
        fromCache: false,
        attachmentNames: [],
        practiceQuiz: publicQuiz,
        examAttemptId: attempt.id,
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
          const isLearnerCache =
            profile?.role === "STUDENT" ||
            profile?.role === "CERTIFICATE_USER";
          let cacheSuggestions: unknown;
          if (
            isLearnerCache &&
            (StudentLearningContextService.wantsCourseSuggestions(question) ||
              /study plan|weak|fail|progress|evaluate|تقييم|خطة|ضعف/i.test(
                question
              ))
          ) {
            const learningCtxCache =
              await StudentLearningContextService.build({
                userId: input.userId,
                language,
                stageId,
                subjectIds: subjectId ? [subjectId] : subjectIds,
                role: profile?.role,
              });
            if (learningCtxCache.courseSuggestions.length) {
              cacheSuggestions = learningCtxCache.courseSuggestions.slice(0, 5);
            }
          }
          return this.persistTurn({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            answer: cached.answer,
            citations: cached.citations,
            fromCache: true,
            attachmentNames: [],
            courseSuggestions: cacheSuggestions,
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
    const memoryBlurb = StudentMemoryService.toPromptBlurb({
      ...memory,
      examResults: memory.examResults,
    });

    const isLearner =
      profile?.role === "STUDENT" || profile?.role === "CERTIFICATE_USER";
    const learningCtx = isLearner
      ? await StudentLearningContextService.build({
          userId: input.userId,
          language,
          stageId,
          subjectIds: subjectId ? [subjectId] : subjectIds,
          role: profile?.role,
        })
      : null;

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
    const tutoringCore = editIntent
      ? null
      : buildTutoringMethodPrompt({
          language,
          audience: isCert
            ? "certificate"
            : isLearner
              ? "student"
              : "general",
          studentBlurb: studentBlurb || undefined,
          memoryBlurb: memoryBlurb || undefined,
          learningCtxBlurb: learningCtx?.promptBlurb || undefined,
        });

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
            : processed.imageParts.length
              ? "Original content is in the attached image(s) — transcribe and edit as requested."
              : "Attachment content could not be extracted.",
          context ? `\nOptional related curriculum context:\n${context}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          tutoringCore!,
          hasAttachments
            ? [
                "The student attached files/photos. Their content is provided below and/or as images.",
                "You MUST analyze the attachment content. Never say the file did not arrive, was not received, or that you cannot access attachments when content is present below.",
                "If attachment text is empty and you cannot see an image, ask them to re-upload a clearer photo or PDF/DOCX/TXT.",
              ].join(" ")
            : "",
          /ملخص|summary|summariz|پوختە|özet/i.test(question)
            ? "The student asked for a summary. Produce a clear structured summary with: title, key points, important definitions, and a short revision checklist. Prefer attached material and retrieved curriculum. Still use the explanation method and FOLLOW_UPS block."
            : "",
          /مرشح|وزاري|وزارية|ministry.?style|exam filter|فلتەر|filtre/i.test(question)
            ? "The student asked for ministry-style exam filters (مرشحات وزارية). Generate likely exam questions in the local ministry style: mix MCQ and short answer, cover high-yield topics from the material, group by difficulty, and include brief answer keys. Add FOLLOW_UPS offering to solve one question together."
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
                  "Still teach with the full explanation method (steps, analogy, study tip, FOLLOW_UPS).",
                  "Clearly say when your answer is general tutoring and not quoted from U Learn uploaded materials.",
                  "Do NOT invent that a specific uploaded PDF/page says something it does not.",
                ]
                  .filter(Boolean)
                  .join(" ")
              : "",
          context ? `\nRetrieved material:\n${context}` : "",
          processed.textExcerpt
            ? `\nExtracted text from attached documents/photos (treat as the student's file content):\n${processed.textExcerpt}`
            : hasAttachments
              ? "\nNote: attachment bytes were received but text could not be extracted yet — if images are attached, read them visually."
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

    // Prefer transcribed text for chat-only models (DeepSeek). Keep raw images
    // only when OCR produced little/no text so a vision model can still help.
    const ocrStrong = processed.textExcerpt.replace(/\s+/g, " ").trim().length > 80;
    const userParts: ChatContentPart[] = ocrStrong ? [] : [...processed.imageParts];
    const userContent = [
      question,
      processed.textExcerpt
        ? `\n\n[Attached file content]\n${processed.textExcerpt}`
        : "",
    ]
      .filter(Boolean)
      .join("");

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.reverse().map((m) => ({
        role: (m.role === "ASSISTANT" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      })),
      {
        role: "user",
        content: userContent || question,
        parts: userParts.length ? userParts : undefined,
      },
    ];

    // If files were attached but we got neither OCR text nor images, fail clearly.
    if (
      hasAttachments &&
      !processed.textExcerpt.trim() &&
      !processed.imageParts.length
    ) {
      const failMsg =
        language === "ar"
          ? "استلمت الملف لكن تعذر قراءة محتواه. أعد رفع صورة أوضح أو ملف PDF/DOCX/TXT."
          : "The file was received but its content could not be read. Please re-upload a clearer photo or a PDF/DOCX/TXT file.";
      return this.persistTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        question: attachmentAwareQuestionLabel(question, attachments),
        answer: failMsg,
        citations: [],
        fromCache: false,
        attachmentNames: attachments.map((a) => a.fileName),
      });
    }

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

    const { cleanText, followUps } = editIntent
      ? { cleanText: answer, followUps: [] as string[] }
      : extractFollowUps(answer);
    answer = cleanText;

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

    const includeSuggestions =
      Boolean(learningCtx?.courseSuggestions.length) &&
      (StudentLearningContextService.wantsCourseSuggestions(question) ||
        /study plan|weak|fail|progress|evaluate|تقييم|خطة|ضعف/i.test(question));

    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question: attachmentAwareQuestionLabel(question, attachments),
      answer,
      citations,
      followUps,
      fromCache: false,
      attachmentNames: attachments.map((a) => a.fileName),
      editedFile,
      courseSuggestions: includeSuggestions
        ? learningCtx!.courseSuggestions.slice(0, 5)
        : undefined,
    });
  }

  /** Merge / design / image tools triggered from natural chat + attachments. */
  private static async runCreativeInChat(input: {
    userId: string;
    conversationId?: string;
    question: string;
    language: string;
    attachments: ChatAttachmentInput[];
    intent: import("./creative/creative-intent").CreativeChatIntent;
  }) {
    const {
      AiCreativeEntitlementService,
      AiCreativeService,
      creativeUpgradeMessage,
      creativeSuccessMessage,
      toCreativeFiles,
    } = await import("./creative");

    try {
      await AiCreativeEntitlementService.assertCanRun(input.userId);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "AI_CREATIVE_ENTITLEMENT") {
        return this.persistTurn({
          userId: input.userId,
          conversationId: input.conversationId,
          question: attachmentAwareQuestionLabel(input.question, input.attachments),
          answer: creativeUpgradeMessage(input.language),
          citations: [],
          fromCache: false,
          attachmentNames: input.attachments.map((a) => a.fileName),
        });
      }
      throw e;
    }

    const files = toCreativeFiles(input.attachments);
    const pdfs = files.filter(
      (f) =>
        f.mimeType.toLowerCase().includes("pdf") ||
        f.fileName.toLowerCase().endsWith(".pdf")
    );
    const images = files.filter(
      (f) =>
        f.mimeType.toLowerCase().startsWith("image/") ||
        /\.(png|jpe?g|gif|webp)$/i.test(f.fileName)
    );

    let result: Awaited<ReturnType<typeof AiCreativeService.merge>>;
    try {
      switch (input.intent) {
        case "merge":
          if (pdfs.length < 2) {
            return this.persistTurn({
              userId: input.userId,
              conversationId: input.conversationId,
              question: attachmentAwareQuestionLabel(
                input.question,
                input.attachments
              ),
              answer:
                input.language === "ar"
                  ? "لدمج PDF أرفق ملفين على الأقل واطلب الدمج."
                  : "Attach at least two PDF files and ask me to merge them.",
              citations: [],
              fromCache: false,
              attachmentNames: input.attachments.map((a) => a.fileName),
            });
          }
          result = await AiCreativeService.merge(input.userId, pdfs);
          break;
        case "design_ppt":
        case "design_pdf":
        case "design_docx": {
          let outline: string | undefined;
          if (input.attachments.length) {
            const processed = await processAttachments(
              input.attachments,
              input.userId
            );
            outline = processed.textExcerpt.slice(0, 12000) || undefined;
          }
          const title =
            input.question.replace(/^['"\s]+|['"\s]+$/g, "").slice(0, 80) ||
            (input.language === "ar" ? "عرض تعليمي" : "Study presentation");
          result = await AiCreativeService.design(input.userId, {
            format:
              input.intent === "design_ppt"
                ? "ppt"
                : input.intent === "design_docx"
                  ? "docx"
                  : "pdf",
            title,
            prompt: [
              input.question,
              outline
                ? "Build the presentation/document from the attached source material below. DeepSeek writes text; FLUX will paint professional figures."
                : "DeepSeek writes the text; FLUX will paint professional educational figures in the file.",
            ]
              .filter(Boolean)
              .join("\n\n"),
            language: input.language,
            outline,
          });
          break;
        }
        case "image_edit":
          if (!images[0]) {
            return this.persistTurn({
              userId: input.userId,
              conversationId: input.conversationId,
              question: attachmentAwareQuestionLabel(
                input.question,
                input.attachments
              ),
              answer:
                input.language === "ar"
                  ? "أرفق صورة واكتب تعليمات التعديل."
                  : "Attach an image and describe how to edit it.",
              citations: [],
              fromCache: false,
              attachmentNames: input.attachments.map((a) => a.fileName),
            });
          }
          result = await AiCreativeService.image(input.userId, {
            mode: "edit",
            prompt: input.question,
            language: input.language,
            image: images[0],
          });
          break;
        case "image_design": {
          // If an image is attached, treat as edit/recreate; otherwise design from prompt (+ PDF text if any).
          if (images[0]) {
            result = await AiCreativeService.image(input.userId, {
              mode: "edit",
              prompt: input.question,
              language: input.language,
              image: images[0],
            });
          } else {
            let extra = "";
            if (input.attachments.length) {
              const processed = await processAttachments(
                input.attachments,
                input.userId
              );
              extra = processed.textExcerpt.slice(0, 4000);
            }
            result = await AiCreativeService.image(input.userId, {
              mode: "design",
              prompt: extra
                ? `${input.question}\n\nSource material:\n${extra}`
                : input.question,
              language: input.language,
            });
          }
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Creative job failed";
      return this.persistTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        question: attachmentAwareQuestionLabel(input.question, input.attachments),
        answer: msg,
        citations: [],
        fromCache: false,
        attachmentNames: input.attachments.map((a) => a.fileName),
      });
    }

    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question: attachmentAwareQuestionLabel(input.question, input.attachments),
      answer: creativeSuccessMessage(input.language, input.intent),
      citations: [],
      fromCache: false,
      attachmentNames: input.attachments.map((a) => a.fileName),
      editedFile: {
        fileName: result.fileName || "creative-result.bin",
        mimeType: result.mimeType || "application/octet-stream",
        contentBase64: result.dataBase64 || "",
        downloadUrl: result.downloadUrl,
        jobId: result.jobId,
      },
    });
  }

  /** Explain / observe selected KB materials with painted educational shapes (FLUX). */
  private static async runExplainObserveWithMaterials(input: {
    userId: string;
    conversationId?: string;
    question: string;
    language: string;
    documentIds: string[];
    stageId?: string | null;
    subjectId?: string | null;
    subjectIds?: string[];
  }) {
    const { AiExamService } = await import("./ai-exam.service");
    const { ExamGeneratorService } = await import("./exam-generator.service");
    const { AiCreativeService } = await import("./creative");
    const { fluxVisibleTextGuidance } = await import("./fonts");
    const { extractFluxFigurePrompts } = await import("./creative/figure-prompts");

    const documentIds = await AiExamService.assertDocumentsAllowed(
      input.userId,
      input.documentIds
    );
    const material = await ExamGeneratorService.loadMaterialForDocuments({
      userId: input.userId,
      documentIds,
      educationalStageId: input.stageId,
      subjectIds: input.subjectId
        ? [input.subjectId]
        : input.subjectIds,
      question: input.question,
    });

    const system = [
      buildTutoringMethodPrompt({
        language: input.language,
        audience: "student",
      }),
      "Mode: explain & observe selected curriculum material.",
      "Explain and help the student observe the selected material clearly.",
      "When the material describes shapes, diagrams, figures, geometry, maps, or labeled drawings:",
      "- Describe them accurately in words.",
      "- Add 1–2 figure blocks so FLUX can paint shapes (NO Arabic letters inside the picture):",
      "[[FLUX]]",
      "English shape-only prompt",
      "LABELS: Arabic label 1 | Arabic label 2",
      "[[/FLUX]]",
      "If there are no shapes, still explain thoroughly with the tutoring method and optionally add one clarifying educational diagram.",
      "Do not invent facts outside the material.",
    ].join("\n");

    const chat = await AiProviderService.chat(
      "TEACHING_ASSISTANT",
      [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Student request:\n${input.question}`,
            `\nSelected material:\n${material.text.slice(0, 14000)}`,
          ].join("\n"),
        },
      ],
      input.userId,
      { maxTokens: 3500 }
    );

    const raw = (chat.text || "").trim();
    const { cleanMarkdown, prompts } = extractFluxFigurePrompts(raw);
    const withoutFlux = cleanMarkdown || raw;
    const { cleanText, followUps } = extractFollowUps(withoutFlux);
    let answer = cleanText;
    let editedFile:
      | {
          fileName: string;
          mimeType: string;
          contentBase64: string;
          downloadUrl?: string;
          jobId?: string;
        }
      | undefined;

    const figurePrompt =
      prompts[0] ||
      (/(شكل|رسم|diagram|shape|figure|هندس)/i.test(material.text)
        ? `Educational diagram matching the shapes described in this material for student observation. ${fluxVisibleTextGuidance(input.language, material.text)} Context: ${material.text.slice(0, 1200)}`
        : null);

    if (figurePrompt) {
      try {
        const img = await AiCreativeService.image(input.userId, {
          mode: "design",
          prompt: figurePrompt,
          language: input.language,
        });
        editedFile = {
          fileName: img.fileName || "observation.png",
          mimeType: img.mimeType || "image/png",
          contentBase64: img.dataBase64 || "",
          downloadUrl: img.downloadUrl,
          jobId: img.jobId,
        };
        if (input.language.startsWith("ar")) {
          answer += "\n\nرسمت الأشكال من المادة للملاحظة — انظر الصورة المرفقة.";
        } else {
          answer +=
            "\n\nI painted the material shapes for observation — see the attached image.";
        }
      } catch (e) {
        console.warn(
          "[ai/chat] observe FLUX paint failed",
          e instanceof Error ? e.message : e
        );
      }
    }

    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question: input.question,
      answer: answer || (input.language.startsWith("ar")
        ? "تم الشرح من المادة المحددة."
        : "Here is the explanation from your selected material."),
      citations: material.citations,
      followUps,
      fromCache: false,
      attachmentNames: [],
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
    editedFile?: {
      fileName: string;
      mimeType: string;
      contentBase64: string;
      downloadUrl?: string;
      jobId?: string;
    };
    practiceQuiz?: unknown;
    examAttemptId?: string;
    courseSuggestions?: unknown;
    followUps?: string[];
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

    const citationPayload = {
      ...(Array.isArray(input.citations)
        ? { items: input.citations }
        : ((input.citations as object) || {})),
      ...(input.practiceQuiz ? { practiceQuiz: input.practiceQuiz } : {}),
      ...(input.courseSuggestions
        ? { courseSuggestions: input.courseSuggestions }
        : {}),
      ...(input.followUps?.length ? { followUps: input.followUps } : {}),
    };

    const assistant = await prisma.aiMessage.create({
      data: {
        conversationId,
        userId: input.userId,
        role: "ASSISTANT",
        content: input.answer,
        citations: citationPayload as never,
      },
    });

    return {
      conversationId,
      messageId: assistant.id,
      answer: input.answer,
      citations: input.citations,
      followUps: input.followUps ?? [],
      fromCache: input.fromCache,
      editedFile: input.editedFile,
      practiceQuiz: input.practiceQuiz,
      examAttemptId: input.examAttemptId,
      courseSuggestions: input.courseSuggestions,
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

async function processAttachments(
  attachments: ChatAttachmentInput[],
  userId?: string
): Promise<{
  imageParts: ChatContentPart[];
  textExcerpt: string;
}> {
  const imageParts: ChatContentPart[] = [];
  const texts: string[] = [];
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { r2Client, r2Bucket, isR2Configured } = await import("@/lib/r2");
  const { readFile } = await import("fs/promises");
  const path = await import("path");

  async function loadBuffer(a: ChatAttachmentInput): Promise<Buffer | null> {
    if (a.dataBase64) {
      const raw = a.dataBase64.replace(/^data:[^;]+;base64,/, "");
      try {
        return Buffer.from(raw, "base64");
      } catch {
        return null;
      }
    }
    if (a.fileKey && isR2Configured()) {
      const res = await r2Client.send(
        new GetObjectCommand({ Bucket: r2Bucket, Key: a.fileKey })
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    }
    if (a.fileKey) {
      const local = path.join(process.cwd(), "public", "uploads", a.fileKey);
      return Buffer.from(await readFile(local));
    }
    if (a.fileUrl?.startsWith("http")) {
      const res = await fetch(a.fileUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return null;
  }

  for (const a of attachments) {
    const mime = (a.mimeType || "").toLowerCase();
    const name = a.fileName || "file";
    const buffer = await loadBuffer(a);
    if (!buffer?.length) {
      texts.push(`[${name}] (empty or unreadable file)`);
      continue;
    }
    if (buffer.length > MAX_KEYED_ATTACHMENT_BYTES) {
      texts.push(`[${name}] (file too large)`);
      continue;
    }

    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(name)) {
      const imageMime = mime.startsWith("image/") ? mime : "image/jpeg";
      imageParts.push({
        type: "image",
        mimeType: imageMime,
        dataBase64: buffer.toString("base64"),
      });
      // OCR so chat-only models (DeepSeek/Kimi) still get the content as text.
      try {
        const { OcrService } = await import("./ocr.service");
        const ocr = await OcrService.extractFromImage(buffer, imageMime, name, userId);
        if (ocr.trim()) {
          texts.push(`[${name} — transcribed from photo]\n${ocr.trim()}`);
        } else {
          texts.push(
            `[${name}] (photo attached; OCR returned no text — model should read the image if supported)`
          );
        }
      } catch {
        texts.push(`[${name}] (photo attached; transcription unavailable)`);
      }
      continue;
    }

    try {
      const extracted = await extractTextFromBuffer(buffer, mime, name);
      if (extracted.text?.trim()) {
        texts.push(`[${name}]\n${extracted.text.trim().slice(0, 12000)}`);
      } else {
        const { OcrService } = await import("./ocr.service");
        texts.push(
          await OcrService.describeUnreadablePdf(name)
        );
      }
    } catch (e) {
      texts.push(
        `[${name}] (could not extract text: ${
          e instanceof Error ? e.message : "unsupported format"
        })`
      );
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
