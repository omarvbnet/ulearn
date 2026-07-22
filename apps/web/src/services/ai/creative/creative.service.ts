import { prisma } from "@/lib/prisma";
import { PDFDocument } from "pdf-lib";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";
import path from "path";
import type { AiCreativeTool, Prisma } from "@prisma/client";
import { r2Client, r2Bucket, isR2Configured } from "@/lib/r2";
import { AiProviderService } from "../ai-provider.service";
import { languageInstruction } from "../types";
import type { ChatMessage } from "../types";
import {
  buildDocx,
  buildPdf,
  buildPptx,
  type ExportFigure,
} from "../professor/export.service";
import { fluxVisibleTextGuidance } from "../fonts";
import { extractFluxFigurePrompts } from "./figure-prompts";
import {
  burnArabicTypographyOntoPng,
  extractEducationalLabels,
} from "../arabic-image-text";
import { buildAmazingFluxPaintPrompt } from "./flux-paint";
import {
  AiCreativeEntitlementService,
  type AiCreativeAccessReason,
} from "./entitlement.service";

export type CreativeFileInput = {
  fileName: string;
  mimeType: string;
  dataBase64?: string;
  fileKey?: string;
  fileUrl?: string;
};

function stripDataUrl(b64: string) {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

async function loadBytes(fileKey?: string | null, fileUrl?: string | null): Promise<Uint8Array> {
  if (fileKey && isR2Configured()) {
    const res = await r2Client.send(
      new GetObjectCommand({ Bucket: r2Bucket, Key: fileKey })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("Empty uploaded file");
    return bytes;
  }
  if (fileKey) {
    const local = path.join(process.cwd(), "public", "uploads", fileKey);
    return new Uint8Array(await readFile(local));
  }
  if (fileUrl?.startsWith("http") || fileUrl?.startsWith("/")) {
    const url = fileUrl.startsWith("http")
      ? fileUrl
      : `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}${fileUrl}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch uploaded file");
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("No file source");
}

async function resolveFileBytes(file: CreativeFileInput): Promise<Buffer> {
  if (file.fileKey || file.fileUrl) {
    return Buffer.from(await loadBytes(file.fileKey, file.fileUrl));
  }
  if (file.dataBase64) {
    return Buffer.from(stripDataUrl(file.dataBase64), "base64");
  }
  throw new Error(`Missing file data for ${file.fileName}`);
}

async function mergePdfs(files: CreativeFileInput[]): Promise<{
  bytes: Uint8Array;
  fileName: string;
  mime: string;
}> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const buf = await resolveFileBytes(f);
    const isPdf =
      f.mimeType.includes("pdf") || f.fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw new Error(
        `Merge currently supports PDF files only (got ${f.fileName}). Convert PPT to PDF first.`
      );
    }
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save();
  return {
    bytes,
    fileName: `merged-${Date.now()}.pdf`,
    mime: "application/pdf",
  };
}

export class AiCreativeService {
  private static async startJob(
    userId: string,
    tool: AiCreativeTool,
    inputMeta: Prisma.InputJsonValue
  ) {
    const entitlement = await AiCreativeEntitlementService.assertCanRun(userId);
    const job = await prisma.aiCreativeJob.create({
      data: {
        userId,
        tool,
        status: "RUNNING",
        inputMeta,
      },
    });
    return { job, entitlement };
  }

  private static async finishSuccess(input: {
    userId: string;
    jobId: string;
    entitlementReason: AiCreativeAccessReason;
    fileName: string;
    mime: string;
    content: string;
  }) {
    const job = await prisma.aiCreativeJob.update({
      where: { id: input.jobId },
      data: {
        status: "SUCCEEDED",
        resultFileName: input.fileName,
        resultMime: input.mime,
        resultContent: input.content,
      },
    });
    await AiCreativeEntitlementService.recordUse(
      input.userId,
      input.jobId,
      input.entitlementReason
    );
    return job;
  }

  private static async finishFail(jobId: string, message: string) {
    await prisma.aiCreativeJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message.slice(0, 2000) },
    });
  }

  static async merge(userId: string, files: CreativeFileInput[]) {
    if (files.length < 2) throw new Error("At least 2 files required to merge");
    const { job, entitlement } = await this.startJob(userId, "MERGE", {
      fileCount: files.length,
      names: files.map((f) => f.fileName),
    });
    try {
      const merged = await mergePdfs(files);
      const saved = await this.finishSuccess({
        userId,
        jobId: job.id,
        entitlementReason: entitlement.reason,
        fileName: merged.fileName,
        mime: merged.mime,
        content: Buffer.from(merged.bytes).toString("base64"),
      });
      return this.toResult(saved);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Merge failed";
      await this.finishFail(job.id, msg);
      throw e;
    }
  }

  static async design(
    userId: string,
    input: {
      format: "ppt" | "pdf" | "docx";
      title: string;
      prompt: string;
      language?: string;
      outline?: string;
    }
  ) {
    const tool: AiCreativeTool =
      input.format === "ppt"
        ? "DESIGN_PPT"
        : input.format === "docx"
          ? "DESIGN_PDF"
          : "DESIGN_PDF";
    const { job, entitlement } = await this.startJob(userId, tool, {
      format: input.format,
      title: input.title,
      prompt: input.prompt.slice(0, 500),
    });
    try {
      const language = (input.language || "en").slice(0, 8);
      const formatLabel =
        input.format === "ppt"
          ? "presentation"
          : input.format === "docx"
            ? "Word document"
            : "PDF document";
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are AI Creative Studio for students (text author = DeepSeek; figures = FLUX).",
            `Produce a high-quality ${formatLabel} in Markdown.`,
            "Include a clear title, short learning objectives, and ## section headings.",
            "For presentations, keep each ## section suitable for one slide with bullet points.",
            "Use real ASCII math in Latin letters, e.g. f(x) = 2x + 3 — never replace formulas with placeholders.",
            "Keep bullets short (one idea each). Prefer ### for sub-topics inside a section.",
            "After each major section that needs a diagram/infographic/shape illustration, add exactly one figure block with a RICH English paint brief:",
            "[[FLUX]]",
            "Detailed shape-only scene: composition, main geometry, colors, markers A/B/C (NO Arabic letters in the picture).",
            "LABELS: short Arabic labels separated by | (burned with professional Noto fonts after painting)",
            "[[/FLUX]]",
            "Add 2–4 [[FLUX]] blocks total. Make each paint brief specific and beautiful enough for a textbook figure.",
            "DeepSeek owns all document text; FLUX only paints shapes — never put Arabic inside FLUX prompts as drawable glyphs.",
            languageInstruction(language),
            "Do not wrap the entire document in a code fence.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Title: ${input.title}`,
            input.outline ? `Outline / source material:\n${input.outline}` : "",
            `Request:\n${input.prompt}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ];
      const creativeAssigned = await AiProviderService.resolveProvider("AI_CREATIVE");
      if (!creativeAssigned) {
        throw new Error(
          "Assign AI_CREATIVE to DeepSeek in Admin → AI Providers (text for PDF/PPT/Word)."
        );
      }
      if (creativeAssigned.type !== "DEEPSEEK") {
        console.warn(
          `[creative/design] AI_CREATIVE is ${creativeAssigned.type} (${creativeAssigned.name}); prefer DeepSeek for Arabic document text.`
        );
      }
      const result = await AiProviderService.chat(
        "AI_CREATIVE",
        messages,
        userId,
        {
          maxTokens: 4096,
          preferTypes: ["DEEPSEEK"],
          // Document body text must be DeepSeek — never Gemini/OpenAI/Jina/FLUX.
          skipTypes: [
            "FLUX",
            "JINA",
            "GEMINI",
            "OPENAI",
            "OPENAI_COMPATIBLE",
            "KIMI",
            "ANTHROPIC",
          ],
        }
      );
      if (result.providerType !== "DEEPSEEK") {
        throw new Error(
          `PDF/PPT text must be written by DeepSeek (got ${result.providerType}). Assign AI_CREATIVE → DeepSeek in Admin.`
        );
      }
      console.info(
        `[creative/design] text provider=${result.providerType} (${result.providerName})`
      );
      const rawMd = (result.text || "").trim();
      if (!rawMd) throw new Error("Empty generation result from DeepSeek / AI_CREATIVE");

      const { cleanMarkdown, figures: figureSpecs } =
        extractFluxFigurePrompts(rawMd);
      const markdown = cleanMarkdown || rawMd;
      const figures = await this.generateDesignFigures(
        userId,
        figureSpecs,
        language,
        input.prompt
      );

      const safe =
        input.title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "creative";
      if (input.format === "ppt") {
        const buf = await buildPptx(input.title, markdown, language, figures);
        const saved = await this.finishSuccess({
          userId,
          jobId: job.id,
          entitlementReason: entitlement.reason,
          fileName: `${safe}.pptx`,
          mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          content: buf.toString("base64"),
        });
        return this.toResult(saved);
      }
      if (input.format === "docx") {
        const buf = await buildDocx(input.title, markdown, figures, language);
        const saved = await this.finishSuccess({
          userId,
          jobId: job.id,
          entitlementReason: entitlement.reason,
          fileName: `${safe}.docx`,
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: buf.toString("base64"),
        });
        return this.toResult(saved);
      }
      const bytes = await buildPdf(input.title, markdown, language, figures);
      const saved = await this.finishSuccess({
        userId,
        jobId: job.id,
        entitlementReason: entitlement.reason,
        fileName: `${safe}.pdf`,
        mime: "application/pdf",
        content: Buffer.from(bytes).toString("base64"),
      });
      return this.toResult(saved);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Design failed";
      await this.finishFail(job.id, msg);
      throw e;
    }
  }

  /** FLUX figures for designed documents (DeepSeek writes text; FLUX paints shapes; Noto burns Arabic). */
  private static async generateDesignFigures(
    userId: string,
    specs: Array<{ prompt: string; labels: string[] }>,
    language: string,
    contextPrompt: string
  ): Promise<ExportFigure[]> {
    if (!specs.length) return [];
    const fluxProvider = await AiProviderService.resolveProvider("AI_CREATIVE_IMAGE");
    if (fluxProvider?.type !== "FLUX" || !fluxProvider.apiKeyEncrypted) {
      return [];
    }
    const figures: ExportFigure[] = [];
    for (const spec of specs.slice(0, 4)) {
      try {
        const educationalPrompt = buildAmazingFluxPaintPrompt({
          subjectPrompt: spec.prompt,
          language,
          context: contextPrompt,
          purpose: "document_figure",
        });
        const generated = await AiProviderService.generateImage(
          { prompt: educationalPrompt },
          userId
        );
        const labels =
          spec.labels.length > 0
            ? spec.labels
            : extractEducationalLabels(`${spec.prompt}\n${contextPrompt}`);
        const caption = labels[0] || spec.prompt.slice(0, 80);
        const pngBase64 = await burnArabicTypographyOntoPng(
          generated.dataBase64,
          {
            title: caption,
            labels: labels.slice(0, 6),
            language,
          }
        );
        figures.push({
          pngBase64,
          caption,
        });
      } catch (e) {
        console.warn(
          "[creative/design] FLUX figure failed",
          e instanceof Error ? e.message : e
        );
      }
    }
    return figures;
  }

  static async image(
    userId: string,
    input: {
      mode: "edit" | "design";
      prompt: string;
      language?: string;
      image?: CreativeFileInput;
    }
  ) {
    const tool: AiCreativeTool =
      input.mode === "edit" ? "IMAGE_EDIT" : "IMAGE_DESIGN";
    if (input.mode === "edit" && !input.image) {
      throw new Error("Image upload required for edit mode");
    }
    const { job, entitlement } = await this.startJob(userId, tool, {
      mode: input.mode,
      prompt: input.prompt.slice(0, 500),
      hasImage: Boolean(input.image),
    });
    try {
      const language = (input.language || "en").slice(0, 8);
      const fluxProvider = await AiProviderService.resolveProvider("AI_CREATIVE_IMAGE");
      if (fluxProvider?.type !== "FLUX" || !fluxProvider.apiKeyEncrypted) {
        throw new Error(
          "Image generation requires FLUX (AI_CREATIVE_IMAGE). Assign FLUX.1 Kontext Max in Admin → AI Providers."
        );
      }

      const labels = extractEducationalLabels(input.prompt);
      const educationalPrompt = buildAmazingFluxPaintPrompt({
        subjectPrompt: input.prompt,
        language,
        purpose: "standalone",
      });
      const finalPrompt = [
        educationalPrompt,
        "Illustrate the SAME subject and explanation described in the prompt — do not invent a different topic.",
        input.mode === "edit"
          ? "Edit the provided image according to the instructions. Remove garbled Arabic text; keep shapes crystal clear."
          : "",
        fluxVisibleTextGuidance(language, input.prompt),
      ]
        .filter(Boolean)
        .join("\n");
      const fluxInput: {
        prompt: string;
        inputImageBase64?: string;
        mimeType?: string;
      } = { prompt: finalPrompt };
      if (input.mode === "edit" && input.image) {
        const imgBytes = await resolveFileBytes(input.image);
        fluxInput.inputImageBase64 = imgBytes.toString("base64");
        fluxInput.mimeType = input.image.mimeType || "image/jpeg";
      }
      const generated = await AiProviderService.generateImage(fluxInput, userId);
      const title =
        labels[0] ||
        input.prompt.replace(/\s+/g, " ").trim().slice(0, 60) ||
        (language.startsWith("ar") ? "رسم تعليمي" : "Educational graphic");
      const pngBase64 = await burnArabicTypographyOntoPng(generated.dataBase64, {
        title,
        labels: labels.slice(0, 6),
        language,
      });
      const saved = await this.finishSuccess({
        userId,
        jobId: job.id,
        entitlementReason: entitlement.reason,
        fileName: `creative-${input.mode}-${Date.now()}.png`,
        mime: generated.mimeType || "image/png",
        content: pngBase64,
      });
      return this.toResult(saved);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Image job failed";
      await this.finishFail(job.id, msg);
      throw e;
    }
  }

  static async getJob(userId: string, jobId: string) {
    return prisma.aiCreativeJob.findFirst({ where: { id: jobId, userId } });
  }

  static toResult(job: {
    id: string;
    tool: AiCreativeTool;
    status: string;
    resultFileName: string | null;
    resultMime: string | null;
    resultContent: string | null;
    countedAsUse: boolean;
    createdAt: Date;
  }) {
    // Prefer download URL for large artifacts (avoids proxy body limits on base64 JSON).
    // Keep images inline more often so chat can preview without a second fetch.
    const isImage = (job.resultMime || "").startsWith("image/");
    const inlineLimit = isImage ? 2_500_000 : 400_000;
    const includeInline =
      !job.resultContent || job.resultContent.length < inlineLimit;
    return {
      jobId: job.id,
      tool: job.tool,
      status: job.status,
      fileName: job.resultFileName,
      mimeType: job.resultMime,
      dataBase64: includeInline ? job.resultContent : null,
      downloadUrl: `/api/ai/creative/jobs/${job.id}/download`,
      countedAsUse: job.countedAsUse,
      createdAt: job.createdAt.toISOString(),
    };
  }
}
