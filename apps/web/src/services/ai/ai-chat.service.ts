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
  buildAiTeacherSystemPrompt,
  parseAiTeacherLesson,
  type AiTeacherLesson,
} from "./ai-teacher-prompt";
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
    /** chat | practice_quiz | edit | explain_observe | from_materials | ai_teacher */
    mode?:
      | "chat"
      | "practice_quiz"
      | "edit"
      | "explain_observe"
      | "from_materials"
      | "ai_teacher";
    /** KB document ids for practice quiz / explain-observe material selection. */
    documentIds?: string[];
    /** Chapter/section title within the selected material. */
    chapterHeading?: string | null;
    chunkFrom?: number | null;
    chunkTo?: number | null;
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

    // Learners need an active free/course/AI subscription to use AI chat.
    const learnerCreative =
      profile?.role === "STUDENT" || profile?.role === "CERTIFICATE_USER";
    if (learnerCreative) {
      try {
        await (
          await import("./creative/entitlement.service")
        ).AiCreativeEntitlementService.assertCanRun(input.userId);
      } catch (e) {
        const err = e as Error & {
          code?: string;
          status?: import("./creative/entitlement.service").AiCreativeEntitlementStatus;
        };
        if (err.code === "AI_CREATIVE_ENTITLEMENT") {
          const { creativeUpgradeMessage } = await import(
            "./creative/creative-intent"
          );
          return {
            conversationId: input.conversationId || null,
            messageId: null,
            answer: creativeUpgradeMessage(language),
            citations: [],
            fromCache: false,
            needsUpgrade: true,
            entitlement: err.status || null,
          };
        }
        throw e;
      }
    }

    // Creative Studio: attachments are the escape hatch for external files.
    // Without attachments, design/file generation must use stage material → chapter.
    const { detectCreativeChatIntent } = await import("./creative/creative-intent");
    const creativeIntent = learnerCreative
      ? detectCreativeChatIntent(question, attachments)
      : null;

    if (creativeIntent && attachments.length > 0) {
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
    if (
      creativeIntent &&
      !attachments.length &&
      (creativeIntent === "merge" || creativeIntent === "image_edit")
    ) {
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

    const {
      detectExplainObserveIntent,
      materialSelectMessage,
      chapterSelectMessage,
      isChitchatOrMeta,
      matchMentionedMaterials,
      dedupeMaterialsByFileName,
    } = await import("./creative/figure-prompts");
    const { AiExamService } = await import("./ai-exam.service");

    const practiceQuiz = input.mode === "practice_quiz";
    const aiTeacher = input.mode === "ai_teacher";
    const explainObserve =
      input.mode === "explain_observe" ||
      (learnerCreative &&
        !attachments.length &&
        !practiceQuiz &&
        input.mode !== "edit" &&
        detectExplainObserveIntent(question));

    const creativeNeedsMaterial =
      Boolean(creativeIntent) &&
      !attachments.length &&
      creativeIntent !== "merge" &&
      creativeIntent !== "image_edit";

    // Grounded curriculum: material buttons → chapter buttons → answer/exam/file.
    // Attachments outside stage materials allow external knowledge / editing.
    const skipMaterialGate =
      input.mode === "edit" || attachments.length > 0;

    const wantsGroundedAnswer =
      learnerCreative &&
      !skipMaterialGate &&
      !practiceQuiz &&
      !input.documentIds?.length &&
      !isChitchatOrMeta(question) &&
      (explainObserve ||
        creativeNeedsMaterial ||
        input.mode === "from_materials" ||
        Boolean(question.trim()));

    const pendingMode: string = aiTeacher
      ? "ai_teacher"
      : practiceQuiz
      ? "practice_quiz"
      : creativeNeedsMaterial && creativeIntent
        ? creativeIntent
        : "explain_observe";

    if (
      learnerCreative &&
      !skipMaterialGate &&
      (practiceQuiz ||
        explainObserve ||
        wantsGroundedAnswer ||
        creativeNeedsMaterial ||
        input.mode === "from_materials" ||
        Boolean(input.documentIds?.length))
    ) {
      const library = await AiExamService.listKbDocumentsForUser(input.userId);
      const materials = dedupeMaterialsByFileName(
        library.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          pageCount: d.pageCount,
        }))
      );

      let documentIds = [...(input.documentIds || [])];
      if (!documentIds.length) {
        documentIds = matchMentionedMaterials(question, materials);
      }
      if (documentIds.length > 1) {
        documentIds = documentIds.slice(0, 1);
      }

      if (!documentIds.length) {
        return {
          conversationId: input.conversationId || null,
          messageId: null,
          answer: materialSelectMessage(language, materials),
          citations: [],
          fromCache: false,
          needsMaterialSelection: true,
          pendingMode,
          pendingQuestion: question,
          pendingCount: practiceQuiz
            ? input.count === 10 || input.count === 20
              ? input.count
              : 5
            : undefined,
          materials,
        };
      }

      const chapterHeading = (input.chapterHeading || "").trim();
      if (!chapterHeading) {
        const chapters = await AiExamService.listDocumentChapters(
          input.userId,
          documentIds[0]!
        );
        const materialName =
          materials.find((m) => m.id === documentIds[0])?.fileName ||
          undefined;
        const onlyWholeFile =
          chapters.length <= 1 &&
          (chapters[0]?.id === "__all__" ||
            chapters[0]?.title === materialName);

        if (aiTeacher) {
          const autoChapter = chapters[0];
          const resolvedChapterEarly = autoChapter?.id || "__all__";
          return this.runAiTeacherLesson({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            language,
            stageId,
            subjectId,
            subjectIds,
            profile,
            memory,
            isCert,
            studentName,
            stageName,
            interestNames,
            grade,
            attachments,
            documentIds,
            chapterHeading: resolvedChapterEarly,
            chunkFrom: autoChapter?.chunkFrom ?? input.chunkFrom,
            chunkTo: autoChapter?.chunkTo ?? input.chunkTo,
          });
        }

        if (!onlyWholeFile) {
          return {
            conversationId: input.conversationId || null,
            messageId: null,
            answer: chapterSelectMessage(language, materialName),
            citations: [],
            fromCache: false,
            needsChapterSelection: true,
            pendingMode,
            pendingQuestion: question,
            pendingCount: practiceQuiz
              ? input.count === 10 || input.count === 20
                ? input.count
                : 5
              : undefined,
            documentIds,
            chapters: chapters.map((c) => ({
              id: c.id,
              title: c.title,
              chunkFrom: c.chunkFrom,
              chunkTo: c.chunkTo,
              pageStart: c.pageStart,
            })),
          };
        }

        // Single whole-file outline → proceed with that scope
        const autoChapter = chapters[0];
        const resolvedChapterEarly = autoChapter?.id || "__all__";
        const chapterOptsEarly = {
          chapterHeading: resolvedChapterEarly,
          chunkFrom: autoChapter?.chunkFrom ?? input.chunkFrom,
          chunkTo: autoChapter?.chunkTo ?? input.chunkTo,
        };

        if (practiceQuiz) {
          return this.runPracticeQuizFromMaterials({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            language,
            documentIds,
            stageId,
            subjectId,
            subjectIds,
            count: input.count,
            ...chapterOptsEarly,
          });
        }

        if (
          creativeNeedsMaterial &&
          creativeIntent &&
          (creativeIntent === "design_ppt" ||
            creativeIntent === "design_pdf" ||
            creativeIntent === "design_docx" ||
            creativeIntent === "image_design")
        ) {
          const { ExamGeneratorService } = await import("./exam-generator.service");
          const allowed = await AiExamService.assertDocumentsAllowed(
            input.userId,
            documentIds
          );
          const material = await ExamGeneratorService.loadMaterialForDocuments({
            userId: input.userId,
            documentIds: allowed,
            educationalStageId: stageId,
            subjectIds: subjectId ? [subjectId] : subjectIds,
            question,
            ...chapterOptsEarly,
          });
          return this.runCreativeInChat({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            language,
            attachments: [],
            intent: creativeIntent,
            materialOutline: [
              `STRICT: Use ONLY this selected stage chapter/material. Do not invent topics outside it.`,
              `Chapter: ${resolvedChapterEarly}`,
              material.text.slice(0, 12000),
            ].join("\n\n"),
          });
        }

        if (aiTeacher) {
          return this.runAiTeacherLesson({
            userId: input.userId,
            conversationId: input.conversationId,
            question,
            language,
            stageId,
            subjectId,
            subjectIds,
            profile,
            memory,
            isCert,
            studentName,
            stageName,
            interestNames,
            grade,
            attachments,
            documentIds,
            ...chapterOptsEarly,
          });
        }

        return this.runExplainObserveWithMaterials({
          userId: input.userId,
          conversationId: input.conversationId,
          question,
          language,
          documentIds,
          stageId,
          subjectId,
          subjectIds,
          ...chapterOptsEarly,
        });
      }

      const resolvedChapter = (input.chapterHeading || "__all__").trim();
      const chapterOpts = {
        chapterHeading: resolvedChapter,
        chunkFrom: input.chunkFrom,
        chunkTo: input.chunkTo,
      };

      if (practiceQuiz) {
        return this.runPracticeQuizFromMaterials({
          userId: input.userId,
          conversationId: input.conversationId,
          question,
          language,
          documentIds,
          stageId,
          subjectId,
          subjectIds,
          count: input.count,
          ...chapterOpts,
        });
      }

      if (aiTeacher) {
        return this.runAiTeacherLesson({
          userId: input.userId,
          conversationId: input.conversationId,
          question,
          language,
          stageId,
          subjectId,
          subjectIds,
          profile,
          memory,
          isCert,
          studentName,
          stageName,
          interestNames,
          grade,
          attachments,
          documentIds,
          chapterHeading: resolvedChapter,
          chunkFrom: input.chunkFrom,
          chunkTo: input.chunkTo,
        });
      }

      if (
        creativeNeedsMaterial &&
        creativeIntent &&
        (creativeIntent === "design_ppt" ||
          creativeIntent === "design_pdf" ||
          creativeIntent === "design_docx" ||
          creativeIntent === "image_design")
      ) {
        const { ExamGeneratorService } = await import("./exam-generator.service");
        const allowed = await AiExamService.assertDocumentsAllowed(
          input.userId,
          documentIds
        );
        const material = await ExamGeneratorService.loadMaterialForDocuments({
          userId: input.userId,
          documentIds: allowed,
          educationalStageId: stageId,
          subjectIds: subjectId ? [subjectId] : subjectIds,
          question,
          ...chapterOpts,
        });
        return this.runCreativeInChat({
          userId: input.userId,
          conversationId: input.conversationId,
          question,
          language,
          attachments: [],
          intent: creativeIntent,
          materialOutline: [
            `STRICT: Use ONLY this selected stage chapter/material. Do not invent topics outside it.`,
            `Chapter: ${resolvedChapter}`,
            material.text.slice(0, 12000),
          ].join("\n\n"),
        });
      }

      return this.runExplainObserveWithMaterials({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        language,
        documentIds,
        stageId,
        subjectId,
        subjectIds,
        ...chapterOpts,
      });
    }

    // AI Teacher still requires material selection for learners without attachments.
    if (aiTeacher) {
      return this.runAiTeacherLesson({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        language,
        stageId,
        subjectId,
        subjectIds,
        profile,
        memory,
        isCert,
        studentName,
        stageName,
        interestNames,
        grade,
        attachments,
        documentIds: input.documentIds,
        chapterHeading: input.chapterHeading || undefined,
        chunkFrom: input.chunkFrom ?? undefined,
        chunkTo: input.chunkTo ?? undefined,
      });
    }

    const processed = await processAttachments(attachments, input.userId);
    const editIntent =
      input.mode === "edit" ||
      (hasAttachments && wantsAttachmentEdit(question));

    // Non-learner practice quiz (or any path that skipped the learner gate)
    if (input.mode === "practice_quiz") {
      return this.runPracticeQuizFromMaterials({
        userId: input.userId,
        conversationId: input.conversationId,
        question,
        language,
        documentIds: input.documentIds || [],
        stageId,
        subjectId,
        subjectIds,
        count: input.count,
        chapterHeading: input.chapterHeading,
        chunkFrom: input.chunkFrom,
        chunkTo: input.chunkTo,
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
            ? "For curriculum facts, use ONLY the retrieved educational material below (plus attachments when the student attached external files for knowledge/editing). Do not invent facts outside that material and the student's request. Cite document names/pages when helpful."
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

  /**
   * U Learn AI Teacher — individual whiteboard lesson option.
   * Asks the model for strict JSON (speech + board actions + quiz).
   */
  private static async runAiTeacherLesson(input: {
    userId: string;
    conversationId?: string;
    question: string;
    language: string;
    stageId: string | null;
    subjectId: string | null;
    subjectIds?: string[];
    profile: {
      role?: string | null;
    } | null;
    memory: Awaited<ReturnType<typeof StudentMemoryService.getOrCreate>>;
    isCert: boolean;
    studentName: string | null;
    stageName: string | null;
    interestNames: string[];
    grade: string | number | null;
    attachments: ChatAttachmentInput[];
    documentIds?: string[];
    chapterHeading?: string;
    chunkFrom?: number | null;
    chunkTo?: number | null;
  }) {
    const memoryBlurb = StudentMemoryService.toPromptBlurb({
      ...input.memory,
      examResults: input.memory.examResults,
    });
    const isLearner =
      input.profile?.role === "STUDENT" ||
      input.profile?.role === "CERTIFICATE_USER";
    const learningCtx = isLearner
      ? await StudentLearningContextService.build({
          userId: input.userId,
          language: input.language,
          stageId: input.stageId,
          subjectIds: input.subjectId
            ? [input.subjectId]
            : input.subjectIds,
          role: input.profile?.role,
        })
      : null;

    const studentBlurb = [
      input.studentName ? `Student name: ${input.studentName}` : null,
      input.stageName
        ? input.isCert
          ? `Professional track: ${input.stageName}`
          : `Educational stage: ${input.stageName}`
        : null,
      input.interestNames.length
        ? `Areas of interest: ${input.interestNames.join(", ")}`
        : null,
      input.grade != null && String(input.grade).trim()
        ? `Grade: ${String(input.grade)}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");

    let materialContext = "";
    const selectedDocumentIds =
      input.documentIds?.filter((id) => id && id.trim().length > 0) ?? [];
    if (selectedDocumentIds.length > 0) {
      try {
        const { AiExamService } = await import("./ai-exam.service");
        const { ExamGeneratorService } = await import("./exam-generator.service");
        const allowed = await AiExamService.assertDocumentsAllowed(
          input.userId,
          selectedDocumentIds
        );
        const material = await ExamGeneratorService.loadMaterialForDocuments({
          userId: input.userId,
          documentIds: allowed,
          educationalStageId: input.stageId,
          chapterHeading: input.chapterHeading || "__all__",
          chunkFrom: input.chunkFrom ?? undefined,
          chunkTo: input.chunkTo ?? undefined,
        });
        materialContext = material?.text?.trim() ?? "";
      } catch {
        /* fallback below */
      }
    }
    if (!materialContext) {
      try {
        const emb = await EmbeddingService.embedText(input.question, input.userId);
        if (emb?.length) {
          const hits = await VectorSearchService.search(emb, {
            educationalStageId: input.stageId,
            subjectId: input.subjectId,
            subjectIds: input.subjectId ? undefined : input.subjectIds,
            topK: TOP_K,
            minSimilarity: MIN_SIMILARITY,
            preferLanguage: input.language,
            stageStrict: true,
          });
          if (hits.length) {
            materialContext = compressContext(hits);
          }
        }
      } catch {
        /* optional grounding */
      }
    }

    const processed =
      input.attachments.length > 0
        ? await processAttachments(input.attachments, input.userId)
        : { textExcerpt: "", imageParts: [] as ChatContentPart[] };

    const system = [
      buildAiTeacherSystemPrompt({
        language: input.language,
        studentBlurb: studentBlurb || undefined,
        memoryBlurb: memoryBlurb || undefined,
        learningCtxBlurb: learningCtx?.promptBlurb || undefined,
      }),
      materialContext
        ? `\nOptional curriculum excerpts (use when relevant; do not invent citations):\n${materialContext}`
        : "",
      processed.textExcerpt
        ? `\nStudent attachment text:\n${processed.textExcerpt}`
        : "",
      "",
      "Return ONLY the JSON object for this teaching request. No markdown.",
    ]
      .filter(Boolean)
      .join("\n");

    const history = input.conversationId
      ? await prisma.aiMessage.findMany({
          where: { conversationId: input.conversationId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { role: true, content: true },
        })
      : [];

    const userParts: ChatContentPart[] = [...processed.imageParts];
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.reverse().map((m) => ({
        role: (m.role === "ASSISTANT" ? "assistant" : "user") as
          | "assistant"
          | "user",
        content: m.content,
      })),
      {
        role: "user",
        content: [
          "Teach me this topic as U Learn AI Teacher (whiteboard lesson JSON):",
          input.question,
        ].join("\n"),
        parts: userParts.length ? userParts : undefined,
      },
    ];

    const result = await AiProviderService.chat(
      "TEACHING_ASSISTANT",
      messages,
      input.userId
    );
    const raw = result.text.trim();
    let lesson = parseAiTeacherLesson(raw);

    // First repair pass if the model returned prose / broken JSON.
    if (!lesson) {
      const repair = await AiProviderService.chat(
        "TEACHING_ASSISTANT",
        [
          {
            role: "system",
            content:
              "Convert the teaching content into valid U Learn AI Teacher JSON only. No markdown fences, no extra keys.",
          },
          {
            role: "user",
            content: `Topic: ${input.question}\n\nDraft:\n${raw.slice(0, 12000)}`,
          },
        ],
        input.userId
      );
      lesson = parseAiTeacherLesson(repair.text);
    }

    // Second repair pass with strict schema reminder.
    if (!lesson) {
      const repair2 = await AiProviderService.chat(
        "TEACHING_ASSISTANT",
        [
          {
            role: "system",
            content: [
              "Return ONLY valid JSON for U Learn AI Teacher.",
              "Required keys exactly: language, lesson_title, objective, speech, whiteboard, quiz, summary.",
              "speech must be an array of { time:number, text:string } with at least 1 item.",
              "whiteboard must be an array of { time:number, action:string, parameters:object }.",
              "Do not include markdown fences or explanations.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Topic: ${input.question}\n\nInvalid attempt:\n${raw.slice(0, 8000)}`,
          },
        ],
        input.userId
      );
      lesson = parseAiTeacherLesson(repair2.text);
    }

    // Hard fallback: synthesize a minimal valid lesson from available text.
    if (!lesson) {
      const source = raw || input.question;
      const sentences = source
        .replace(/\s+/g, " ")
        .split(/(?<=[.!؟!])/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 6);
      const speech = (sentences.length ? sentences : [input.question]).map((text, i) => ({
        time: i * 5000,
        text,
      }));
      const whiteboard = speech.map((s, i) => ({
        time: s.time,
        action: "write_text",
        parameters: {
          text: s.text.slice(0, 120),
          x: 120,
          y: 120 + i * 90,
          size: 34,
        },
      }));
      lesson = {
        language: input.language || "en",
        lesson_title:
          input.language === "ar"
            ? "درس تفاعلي"
            : input.language === "tr"
              ? "Etkileşimli Ders"
              : input.language === "ku"
                ? "وانەی هاوکاری"
                : "Interactive Lesson",
        objective: input.question,
        speech,
        whiteboard,
        quiz: [],
        summary: [
          input.language === "ar"
            ? "يمكنني الآن إكمال الشرح خطوة بخطوة مع أمثلة إضافية."
            : input.language === "tr"
              ? "İstersen şimdi adım adım ek örneklerle devam edebilirim."
              : input.language === "ku"
                ? "دەتوانم ئێستا هەنگاو بە هەنگاو بە نموونەی زیاتر درێژە بدەم."
                : "I can now continue step by step with more examples.",
        ],
      };
    }

    if (!lesson) {
      const fail =
        input.language === "ar"
          ? "تعذر تجهيز درس السبورة الآن. أعد المحاولة بصياغة أوضح للموضوع."
          : input.language === "tr"
            ? "Tahta dersi şu an hazırlanamadı. Konuyu daha net yazıp tekrar deneyin."
            : input.language === "ku"
              ? "وانەی تەختە ئامادە نەبوو. بابەتەکە ڕوونتر بنووسە و دووبارە هەوڵ بدە."
              : "Could not prepare the whiteboard lesson. Try rephrasing the topic.";
      return this.persistTurn({
        userId: input.userId,
        conversationId: input.conversationId,
        question: input.question,
        answer: fail,
        citations: [],
        fromCache: false,
        attachmentNames: input.attachments.map((a) => a.fileName),
      });
    }

    // Prefer student’s UI language when model omits it.
    if (!lesson.language) lesson.language = input.language;

    void StudentMemoryService.recordQuestion(
      input.userId,
      input.question,
      input.subjectId
    );

    // Keep chat history short — the live classroom player uses aiTeacherLesson JSON.
    // Never surface the markdown dump as the student-facing lesson body.
    const answer =
      input.language === "ar"
        ? `الفصل المباشر جاهز: ${lesson.lesson_title}`
        : input.language === "tr"
          ? `Canlı sınıf hazır: ${lesson.lesson_title}`
          : input.language === "ku"
            ? `پۆلی ڕاستەوخۆ ئامادەیە: ${lesson.lesson_title}`
            : `Live classroom ready: ${lesson.lesson_title}`;
    return this.persistTurn({
      userId: input.userId,
      conversationId: input.conversationId,
      question: input.question,
      answer,
      citations: [],
      fromCache: false,
      attachmentNames: input.attachments.map((a) => a.fileName),
      aiTeacherLesson: lesson,
      followUps: [
        input.language === "ar"
          ? "مثال آخر أبسط من فضلك"
          : input.language === "tr"
            ? "Daha basit başka bir örnek isterim"
            : "Give me another simpler example",
        input.language === "ar"
          ? "اشرح بمزيد من التفصيل"
          : input.language === "tr"
            ? "Daha ayrıntılı anlat"
            : "Explain in more detail",
      ],
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
    /** Stage chapter text — required grounding when no attachments. */
    materialOutline?: string;
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
          let outline: string | undefined = input.materialOutline?.trim() || undefined;
          if (!outline && input.attachments.length) {
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
                ? "STRICT: Build ONLY from the selected stage chapter/material (or attached source) below. Do not add outside curriculum topics."
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
          if (images[0]) {
            result = await AiCreativeService.image(input.userId, {
              mode: "edit",
              prompt: input.question,
              language: input.language,
              image: images[0],
            });
          } else {
            let extra = input.materialOutline?.trim() || "";
            if (!extra && input.attachments.length) {
              const processed = await processAttachments(
                input.attachments,
                input.userId
              );
              extra = processed.textExcerpt.slice(0, 4000);
            }
            result = await AiCreativeService.image(input.userId, {
              mode: "design",
              prompt: extra
                ? `${input.question}\n\nSTRICT source (stage chapter or attachment only):\n${extra}`
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

  private static async runPracticeQuizFromMaterials(input: {
    userId: string;
    conversationId?: string;
    question: string;
    language: string;
    documentIds: string[];
    stageId?: string | null;
    subjectId?: string | null;
    subjectIds?: string[];
    count?: 5 | 10 | 20;
    chapterHeading?: string | null;
    chunkFrom?: number | null;
    chunkTo?: number | null;
  }) {
    const { ExamGeneratorService } = await import("./exam-generator.service");
    const { AiExamService, stripCorrectKeys } = await import("./ai-exam.service");
    const documentIds = await AiExamService.assertDocumentsAllowed(
      input.userId,
      input.documentIds
    );
    const quiz = await ExamGeneratorService.generatePractice({
      userId: input.userId,
      question: [
        input.question,
        "STRICT: Write exam questions ONLY from the selected chapter/material. Do not invent facts outside it.",
        input.chapterHeading
          ? `Chapter scope: ${input.chapterHeading}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      language: input.language,
      educationalStageId: input.stageId,
      subjectIds: input.subjectId ? [input.subjectId] : input.subjectIds,
      documentIds,
      requireDocuments: true,
      count: input.count === 10 || input.count === 20 ? input.count : 5,
      chapterHeading: input.chapterHeading,
      chunkFrom: input.chunkFrom,
      chunkTo: input.chunkTo,
    });

    let conversationId = input.conversationId;
    if (!conversationId) {
      const conv = await prisma.aiConversation.create({
        data: {
          userId: input.userId,
          title: (quiz.title || input.question).slice(0, 80),
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
      input.language === "ar"
        ? `امتحان جاهز: ${quiz.title}\nاختر الإجابات مباشرة. الوقت: ${attempt.timeLimitSec} ثانية.`
        : `Exam ready: ${quiz.title}\nSelect your answers below. Time limit: ${attempt.timeLimitSec}s.`;

    return this.persistTurn({
      userId: input.userId,
      conversationId,
      question:
        input.question ||
        `Generate exam from ${documentIds.length} material(s)`,
      answer: intro,
      citations: quiz.citations,
      fromCache: false,
      attachmentNames: [],
      practiceQuiz: publicQuiz,
      examAttemptId: attempt.id,
    });
  }

  /** Answer from selected KB materials with optional FLUX educational paintings. */
  private static async runExplainObserveWithMaterials(input: {
    userId: string;
    conversationId?: string;
    question: string;
    language: string;
    documentIds: string[];
    chapterHeading?: string | null;
    chunkFrom?: number | null;
    chunkTo?: number | null;
    stageId?: string | null;
    subjectId?: string | null;
    subjectIds?: string[];
  }) {
    const { AiExamService } = await import("./ai-exam.service");
    const { ExamGeneratorService } = await import("./exam-generator.service");
    const { AiCreativeService } = await import("./creative");
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
      chapterHeading: input.chapterHeading,
      chunkFrom: input.chunkFrom,
      chunkTo: input.chunkTo,
    });

    const system = [
      buildTutoringMethodPrompt({
        language: input.language,
        audience: "student",
      }),
      "Mode: answer ONLY from the selected curriculum chapter/material the student chose.",
      "STRICT GROUNDING: Do not add facts, examples, or topics outside that chapter and the student's request.",
      "If the answer is not in the selected material, say it is not available in that chapter.",
      "Teach clearly: answer the question, explain concepts step by step, use analogies grounded in the text.",
      "Cite the material by file name when helpful.",
      "When the topic benefits from a diagram/shape/infographic, add 1–3 figure blocks:",
      "[[FLUX]]",
      "Detailed English shape-only paint brief (geometry, colors, layout — NO Arabic letters).",
      "LABELS: short Arabic labels separated by | (burned with professional fonts after)",
      "[[/FLUX]]",
      "FLUX briefs must illustrate ONLY concepts present in the selected chapter.",
    ].join("\n");

    const chat = await AiProviderService.chat(
      "TEACHING_ASSISTANT",
      [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Student request:\n${input.question}`,
            input.chapterHeading
              ? `\nSelected chapter: ${input.chapterHeading}`
              : "",
            `\nSelected material text:\n${material.text.slice(0, 14000)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      input.userId,
      { maxTokens: 3500 }
    );

    const raw = (chat.text || "").trim();
    const { cleanMarkdown, figures: figureSpecs, prompts } =
      extractFluxFigurePrompts(raw);
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

    const paintBriefs =
      figureSpecs.length > 0
        ? figureSpecs
        : prompts.length
          ? prompts.map((p) => ({ prompt: p, labels: [] as string[] }))
          : [
              {
                prompt: `Educational illustration that matches this exact lesson explanation (same subject, same concepts). Paint the key idea visually.`,
                labels: [] as string[],
              },
            ];

    // One unique citation chip per document name (not per chunk).
    const citationSeen = new Set<string>();
    const uniqueCitations = (material.citations || []).filter((c) => {
      const key = (c.documentName || "").toLowerCase().trim();
      if (!key || citationSeen.has(key)) return false;
      citationSeen.add(key);
      return true;
    });

    for (const spec of paintBriefs.slice(0, 2)) {
      try {
        const img = await AiCreativeService.image(input.userId, {
          mode: "design",
          prompt: [
            spec.prompt,
            spec.labels.length
              ? `LABELS: ${spec.labels.join(" | ")}`
              : "",
            // Keep FLUX aligned with the same DeepSeek explanation the student reads.
            `DeepSeek explanation to illustrate (match the same subject and steps):\n${answer.slice(0, 1200)}`,
            material.text
              ? `Curriculum source excerpt:\n${material.text.slice(0, 500)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          language: input.language,
        });
        // Keep the first successful painting as the chat attachment preview.
        if (!editedFile) {
          editedFile = {
            fileName: img.fileName || "observation.png",
            mimeType: img.mimeType || "image/png",
            contentBase64: img.dataBase64 || "",
            downloadUrl: img.downloadUrl,
            jobId: img.jobId,
          };
          if (input.language.startsWith("ar")) {
            answer +=
              "\n\nرسمت الأشكال وفق شرح المادة — انظر الصورة المرفقة.";
          } else {
            answer +=
              "\n\nI painted a figure that matches this explanation — see the attached image.";
          }
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
      citations: uniqueCitations,
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
    aiTeacherLesson?: AiTeacherLesson;
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
      ...(input.aiTeacherLesson
        ? { aiTeacherLesson: input.aiTeacherLesson }
        : {}),
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
      aiTeacherLesson: input.aiTeacherLesson,
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
