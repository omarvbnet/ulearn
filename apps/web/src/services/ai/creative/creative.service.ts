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
            "You are AI Creative Studio for students (text author).",
            `Produce a high-quality ${formatLabel} in Markdown.`,
            "Include a clear title, short learning objectives, and ## section headings.",
            "For presentations, keep each ## section suitable for one slide with bullet points.",
            "After each major section that needs a diagram/infographic/shape illustration, add exactly one figure block:",
            "[[FLUX]] detailed English image prompt: recreate educational shapes/diagrams accurately; list exact Arabic (or user-language) labels in quotes [[/FLUX]]",
            "Add 2–4 [[FLUX]] blocks total for professional illustrated materials. Do not invent FLUX blocks without educational value.",
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
      const moduleKey =
        (await AiProviderService.resolveProvider("AI_CREATIVE")) != null
          ? "AI_CREATIVE"
          : (await AiProviderService.resolveProvider("TEACHING_ASSISTANT")) != null
            ? "TEACHING_ASSISTANT"
            : undefined;
      const result = await AiProviderService.chat(
        moduleKey,
        messages,
        userId,
        { maxTokens: 4096 }
      );
      const rawMd = (result.text || "").trim();
      if (!rawMd) throw new Error("Empty generation result");

      const { cleanMarkdown, prompts: figurePrompts } =
        extractFluxFigurePrompts(rawMd);
      const markdown = cleanMarkdown || rawMd;
      const figures = await this.generateDesignFigures(
        userId,
        figurePrompts,
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
        const buf = await buildDocx(input.title, markdown, figures);
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

  /** FLUX figures for designed documents (DeepSeek writes text; FLUX paints). */
  private static async generateDesignFigures(
    userId: string,
    prompts: string[],
    language: string,
    contextPrompt: string
  ): Promise<ExportFigure[]> {
    if (!prompts.length) return [];
    const fluxProvider = await AiProviderService.resolveProvider("AI_CREATIVE_IMAGE");
    if (fluxProvider?.type !== "FLUX" || !fluxProvider.apiKeyEncrypted) {
      return [];
    }
    const figures: ExportFigure[] = [];
    for (const p of prompts.slice(0, 4)) {
      try {
        const educationalPrompt = [
          "Professional educational illustration for a student study document.",
          "Clean textbook style, high contrast, accurate shapes/diagrams.",
          fluxVisibleTextGuidance(language, `${p}\n${contextPrompt}`),
          `Figure request:\n${p}`,
        ].join("\n");
        const generated = await AiProviderService.generateImage(
          { prompt: educationalPrompt },
          userId
        );
        figures.push({
          pngBase64: generated.dataBase64,
          caption: p.slice(0, 120),
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

      const educationalPrompt = [
        "Educational graphic for students — you MUST generate a real raster image (PNG).",
        "Clean, clear, high-contrast illustration suitable for school materials.",
        "Recreate geometric shapes, diagrams, and labeled figures accurately when described.",
        fluxVisibleTextGuidance(language, input.prompt),
        input.mode === "edit"
          ? "Edit the provided image according to the instructions while keeping educational clarity and fixing any garbled Arabic text."
          : "Create a polished educational drawing / infographic / diagram as requested.",
        `Request:\n${input.prompt}`,
      ].join("\n");
      const fluxInput: {
        prompt: string;
        inputImageBase64?: string;
        mimeType?: string;
      } = { prompt: educationalPrompt };
      if (input.mode === "edit" && input.image) {
        const imgBytes = await resolveFileBytes(input.image);
        fluxInput.inputImageBase64 = imgBytes.toString("base64");
        fluxInput.mimeType = input.image.mimeType || "image/jpeg";
      }
      const generated = await AiProviderService.generateImage(fluxInput, userId);
      const saved = await this.finishSuccess({
        userId,
        jobId: job.id,
        entitlementReason: entitlement.reason,
        fileName: `creative-${input.mode}-${Date.now()}.png`,
        mime: generated.mimeType || "image/png",
        content: generated.dataBase64,
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
