import { prisma } from "@/lib/prisma";
import { PDFDocument } from "pdf-lib";
import type { AiCreativeTool, Prisma } from "@prisma/client";
import { AiProviderService } from "../ai-provider.service";
import { languageInstruction } from "../types";
import type { ChatMessage } from "../types";
import { buildPdf, buildPptx } from "../professor/export.service";
import {
  AiCreativeEntitlementService,
  type AiCreativeAccessReason,
} from "./entitlement.service";

export type CreativeFileInput = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

function stripDataUrl(b64: string) {
  return b64.replace(/^data:[^;]+;base64,/, "");
}

function decodeFile(file: CreativeFileInput): Buffer {
  return Buffer.from(stripDataUrl(file.dataBase64), "base64");
}

function extractSvg(text: string): string | null {
  const fence = text.match(/```(?:svg)?\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() || text.trim();
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start >= 0 && end > start) return raw.slice(start, end + 6);
  return null;
}

async function mergePdfs(files: CreativeFileInput[]): Promise<{
  bytes: Uint8Array;
  fileName: string;
  mime: string;
}> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const buf = decodeFile(f);
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
      format: "ppt" | "pdf";
      title: string;
      prompt: string;
      language?: string;
      outline?: string;
    }
  ) {
    const tool: AiCreativeTool =
      input.format === "ppt" ? "DESIGN_PPT" : "DESIGN_PDF";
    const { job, entitlement } = await this.startJob(userId, tool, {
      format: input.format,
      title: input.title,
      prompt: input.prompt.slice(0, 500),
    });
    try {
      const language = (input.language || "en").slice(0, 8);
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are AI Creative Studio for students.",
            `Produce a high-quality ${input.format === "ppt" ? "presentation" : "document"} in Markdown.`,
            "Include a clear title, short learning objectives, and ## section headings.",
            "For presentations, keep each ## section suitable for one slide with bullet points.",
            languageInstruction(language),
            "Do not wrap the entire document in a code fence.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Title: ${input.title}`,
            input.outline ? `Outline:\n${input.outline}` : "",
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
      const markdown = (result.text || "").trim();
      if (!markdown) throw new Error("Empty generation result");

      const safe =
        input.title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "creative";
      if (input.format === "ppt") {
        const buf = await buildPptx(input.title, markdown);
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
      const bytes = await buildPdf(input.title, markdown);
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
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are a professional graphic designer for AI Creative Studio.",
            "Return a complete, self-contained SVG graphic (viewBox recommended).",
            "Use clean typography, balanced layout, and a polished educational look.",
            "Output ONLY the SVG markup (optionally inside a ```svg fence).",
            languageInstruction(language),
          ].join("\n"),
        },
      ];

      if (input.mode === "edit" && input.image) {
        messages.push({
          role: "user",
          content: `Edit this image professionally according to these instructions:\n${input.prompt}\n\nRecreate the result as a polished SVG.`,
          parts: [
            {
              type: "image",
              mimeType: input.image.mimeType || "image/jpeg",
              dataBase64: stripDataUrl(input.image.dataBase64),
            },
          ],
        });
      } else {
        messages.push({
          role: "user",
          content: `Design a professional graphic:\n${input.prompt}`,
        });
      }

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
        { maxTokens: 8192 }
      );
      const svg = extractSvg(result.text || "");
      if (!svg) throw new Error("Could not produce an SVG design from the model");

      const saved = await this.finishSuccess({
        userId,
        jobId: job.id,
        entitlementReason: entitlement.reason,
        fileName: `creative-${input.mode}-${Date.now()}.svg`,
        mime: "image/svg+xml",
        content: Buffer.from(svg, "utf8").toString("base64"),
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
    return {
      jobId: job.id,
      tool: job.tool,
      status: job.status,
      fileName: job.resultFileName,
      mimeType: job.resultMime,
      dataBase64: job.resultContent,
      countedAsUse: job.countedAsUse,
      createdAt: job.createdAt.toISOString(),
    };
  }
}
