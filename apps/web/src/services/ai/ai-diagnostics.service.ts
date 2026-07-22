import { prisma } from "@/lib/prisma";
import { AiProviderService } from "./ai-provider.service";

export type DiagnosticIssue = {
  severity: "error" | "warning" | "ok";
  code: string;
  message: string;
  fix?: string;
};

export class AiDiagnosticsService {
  /** End-to-end health: providers, embedding, chat, KB readiness per stage. */
  static async run() {
    const issues: DiagnosticIssue[] = [];
    const started = Date.now();

    const providers = await prisma.aiProvider.findMany({
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    });
    const assignments = await AiProviderService.listModuleAssignments();
    const enabled = providers.filter((p) => p.status === "ENABLED");
    const withKey = enabled.filter((p) => p.apiKeyEncrypted);

    if (!providers.length) {
      issues.push({
        severity: "error",
        code: "NO_PROVIDERS",
        message: "No AI providers configured.",
        fix: "Add a Gemini/OpenAI provider under AI Providers and set an API key.",
      });
    } else if (!withKey.length) {
      issues.push({
        severity: "error",
        code: "NO_API_KEY",
        message: "Enabled providers are missing API keys.",
        fix: "Edit a provider and paste a valid API key.",
      });
    }

    if (!enabled.some((p) => p.isDefault) && withKey.length) {
      issues.push({
        severity: "warning",
        code: "NO_DEFAULT",
        message: "No default provider set.",
        fix: "Mark one enabled provider as default.",
      });
    }

    const needModules = ["TEACHING_ASSISTANT", "EMBEDDING"] as const;
    for (const key of needModules) {
      const a = assignments.find((x) => x.moduleKey === key);
      if (!a) {
        issues.push({
          severity: "warning",
          code: `MODULE_${key}_UNASSIGNED`,
          message: `Module ${key} has no provider assignment.`,
          fix: "Save module assignments on the AI Providers page.",
        });
      }
    }

    const embedAssignment = assignments.find((x) => x.moduleKey === "EMBEDDING");
    const embedProvider =
      embedAssignment?.provider ||
      enabled.find((p) => p.isDefault) ||
      null;
    const chatAssignment = assignments.find((x) => x.moduleKey === "TEACHING_ASSISTANT");
    const chatProvider =
      chatAssignment?.provider ||
      enabled.find((p) => p.isDefault) ||
      null;

    const chatOnlyTypes = new Set(["DEEPSEEK", "KIMI", "ANTHROPIC"]);
    if (embedProvider && chatOnlyTypes.has(embedProvider.type)) {
      issues.push({
        severity: "error",
        code: "EMBED_CHAT_ONLY_PROVIDER",
        message: `EMBEDDING is assigned to ${embedProvider.type} (${embedProvider.name}), which does not support embeddings (causes 405).`,
        fix: "Add a Gemini provider with model gemini-embedding-001, set its API key, then assign EMBEDDING to Gemini (keep DeepSeek/Claude/Kimi for TEACHING_ASSISTANT only).",
      });
    }

    let embedOk = false;
    let embedMs = 0;
    let embedError: string | null = null;
    let embedDims = 0;
    // Always try embed via withFallback/ensureEmbeddingAssignment — even if
    // EMBEDDING was wrongly pointed at DeepSeek (auto-heals to Gemini when present).
    if (withKey.length) {
      const t0 = Date.now();
      try {
        const vec = await AiProviderService.embed("U Learn diagnostics ping");
        embedOk = Array.isArray(vec) && vec.length > 0;
        embedDims = vec.length;
        embedMs = Date.now() - t0;
        if (!embedOk) {
          issues.push({
            severity: "error",
            code: "EMBED_EMPTY",
            message: "Embedding call returned an empty vector.",
            fix: "Check EMBEDDING module provider and model (use gemini-embedding-001).",
          });
        } else {
          if (embedProvider && chatOnlyTypes.has(embedProvider.type)) {
            issues.push({
              severity: "warning",
              code: "EMBED_AUTO_HEALED",
              message: `EMBEDDING was assigned to ${embedProvider.type}; runtime used an embedding-capable provider instead.`,
              fix: "Save EMBEDDING → Gemini (or OpenAI) on the AI Providers page so the assignment matches runtime.",
            });
          }
          issues.push({
            severity: "ok",
            code: "EMBED_OK",
            message: `Embedding OK (${embedDims} dims, ${embedMs}ms).`,
          });
        }
      } catch (e) {
        embedError = e instanceof Error ? e.message : "Embed failed";
        embedMs = Date.now() - t0;
        const emptyBody = /empty body|non-JSON|Unexpected end/i.test(embedError);
        issues.push({
          severity: "error",
          code: "EMBED_FAIL",
          message: `Embedding failed: ${embedError}`,
          fix: emptyBody
            ? "EMBEDDING provider returned an empty response. Use a dedicated Gemini provider (model gemini-embedding-001, Base URL https://generativelanguage.googleapis.com) with a valid Gemini API key — not DeepSeek."
            : "Add Gemini (gemini-embedding-001) or OpenAI with an API key and assign EMBEDDING to it. DeepSeek cannot embed.",
        });
      }
    }

    let chatOk = false;
    let chatMs = 0;
    let chatError: string | null = null;
    let chatSample = "";
    if (withKey.length) {
      const t0 = Date.now();
      try {
        const result = await AiProviderService.chat(
          "TEACHING_ASSISTANT",
          [
            {
              role: "system",
              content: "Reply with exactly: OK",
            },
            { role: "user", content: "ping" },
          ]
        );
        chatOk = Boolean(result.text?.trim());
        chatSample = (result.text || "").slice(0, 120);
        chatMs = Date.now() - t0;
        if (chatOk) {
          issues.push({
            severity: "ok",
            code: "CHAT_OK",
            message: `Chat OK via ${chatProvider?.type || "provider"} (${chatMs}ms).`,
          });
        } else {
          issues.push({
            severity: "error",
            code: "CHAT_EMPTY",
            message: "Chat provider returned an empty response.",
          });
        }
      } catch (e) {
        chatError = e instanceof Error ? e.message : "Chat failed";
        chatMs = Date.now() - t0;
        const balance = /insufficient.?balance|quota|billing|payment|余额/i.test(chatError);
        const isDeepseek = chatProvider?.type === "DEEPSEEK";
        issues.push({
          severity: "error",
          code: "CHAT_FAIL",
          message: `Chat failed: ${chatError}`,
          fix: balance
            ? "Your chat provider account has no credit (DeepSeek: top up at platform.deepseek.com). Chat will stay down until the balance is positive."
            : isDeepseek
              ? "Confirm DeepSeek API key, model deepseek-chat, Base URL https://api.deepseek.com/v1, and account balance."
              : "Verify TEACHING_ASSISTANT provider, model name, API key, and Base URL.",
        });
      }
    }

    const docs = await prisma.kbDocument.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        fileName: true,
        status: true,
        educationalStageId: true,
        chunkCount: true,
        errorMessage: true,
      },
    });
    const stages = await prisma.educationalStage.findMany({
      where: { deletedAt: null },
      select: { id: true, nameEn: true },
      orderBy: { sortOrder: "asc" },
    });

    const byStage = stages.map((s) => {
      const stageDocs = docs.filter((d) => d.educationalStageId === s.id);
      return {
        stageId: s.id,
        stageName: s.nameEn,
        total: stageDocs.length,
        ready: stageDocs.filter((d) => d.status === "READY").length,
        failed: stageDocs.filter((d) => d.status === "FAILED").length,
        pending: stageDocs.filter((d) =>
          ["PENDING", "PROCESSING"].includes(d.status)
        ).length,
      };
    });

    const unscoped = docs.filter((d) => !d.educationalStageId);
    const failedDocs = docs
      .filter((d) => d.status === "FAILED")
      .map((d) => ({
        id: d.id,
        fileName: d.fileName,
        educationalStageId: d.educationalStageId,
        errorMessage: d.errorMessage,
      }));

    if (!docs.some((d) => d.status === "READY")) {
      issues.push({
        severity: "error",
        code: "KB_EMPTY",
        message: "No READY knowledge documents. AI can only answer from retrieved materials.",
        fix: "Open Knowledge Base, select a stage, upload PDF/TXT/DOCX, wait until status is READY (or Reprocess failed files).",
      });
    } else {
      issues.push({
        severity: "ok",
        code: "KB_READY",
        message: `${docs.filter((d) => d.status === "READY").length} READY document(s) in the knowledge base.`,
      });
    }

    if (failedDocs.length) {
      issues.push({
        severity: "warning",
        code: "KB_FAILED_DOCS",
        message: `${failedDocs.length} document(s) failed processing.`,
        fix: "Open Knowledge Base → Reprocess, or fix storage/API issues shown in the error message.",
      });
    }

    const stagesWithoutReady = byStage.filter((s) => s.ready === 0);
    if (stagesWithoutReady.length && byStage.some((s) => s.ready > 0)) {
      issues.push({
        severity: "warning",
        code: "KB_STAGE_GAPS",
        message: `${stagesWithoutReady.length} stage(s) have no READY materials. Students in those stages may get unavailable answers.`,
        fix: "Upload materials for each stage individually in Knowledge Base.",
      });
    }

    if (unscoped.length) {
      issues.push({
        severity: "warning",
        code: "KB_UNSCOPED",
        message: `${unscoped.length} document(s) have no educational stage. Prefer assigning a stage so retrieval matches students.`,
        fix: "Re-upload under a selected stage, or archive unscoped files.",
      });
    }

    const ok = !issues.some((i) => i.severity === "error");

    return {
      ok,
      latencyMs: Date.now() - started,
      providers: {
        total: providers.length,
        enabled: enabled.length,
        withApiKey: withKey.length,
        defaultId: providers.find((p) => p.isDefault)?.id ?? null,
      },
      modules: assignments.map((a) => ({
        moduleKey: a.moduleKey,
        providerId: a.providerId,
        providerName: a.provider?.name,
      })),
      embedding: { ok: embedOk, dims: embedDims, latencyMs: embedMs, error: embedError },
      chat: { ok: chatOk, latencyMs: chatMs, sample: chatSample, error: chatError },
      knowledgeBase: {
        total: docs.length,
        ready: docs.filter((d) => d.status === "READY").length,
        failed: failedDocs.length,
        byStage,
        unscoped: unscoped.length,
        failedDocs,
      },
      issues,
      checkedAt: new Date().toISOString(),
    };
  }
}
