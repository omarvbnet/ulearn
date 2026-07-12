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
import { buildPdf, buildPptx } from "../professor/export.service";
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

function extractSvg(text: string): string | null {
  const fence = text.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  const raw = (fence?.[1] || text).trim();
  const start = raw.search(/<svg[\s>]/i);
  const end = raw.toLowerCase().lastIndexOf("</svg>");
  if (start >= 0 && end > start) {
    return raw.slice(start, end + "</svg>".length).trim();
  }
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
        const buf = await buildPptx(input.title, markdown, language);
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
      const bytes = await buildPdf(input.title, markdown, language);
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
            "Your ENTIRE reply must be a single valid SVG document (start with <svg and end with </svg>).",
            "Do not write explanations, greetings, or markdown outside the SVG.",
            "You may wrap the SVG in a ```svg fence if needed.",
            "Put any visible labels/titles inside the SVG in the user's language.",
            `User language for text inside the graphic: ${language}.`,
            "Use a clean educational look: viewBox=\"0 0 1080 1080\", balanced layout, readable font-family sans-serif.",
            "Include shapes, colors, and text elements — produce a complete downloadable graphic.",
          ].join("\n"),
        },
      ];

      if (input.mode === "edit" && input.image) {
        const imgBytes = await resolveFileBytes(input.image);
        // Cap vision payload size
        const b64 = imgBytes.toString("base64");
        messages.push({
          role: "user",
          content: `Edit/recreate this image as SVG per these instructions (SVG only):\n${input.prompt}`,
          parts: [
            {
              type: "image",
              mimeType: input.image.mimeType || "image/jpeg",
              dataBase64: b64,
            },
          ],
        });
      } else {
        messages.push({
          role: "user",
          content: `Design this as a complete SVG graphic (SVG markup only):\n${input.prompt}`,
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
        { maxTokens: 8192, temperature: 0.4 }
      );
      let svg = extractSvg(result.text || "");
      if (!svg) {
        // Fallback: wrap model text into a simple branded SVG card
        const safeText = (result.text || input.prompt || "Design")
          .replace(/[<>&]/g, "")
          .slice(0, 400);
        const lines = safeText.split(/\n/).filter(Boolean).slice(0, 8);
        const textEls = lines
          .map(
            (line, i) =>
              `<text x="540" y="${280 + i * 48}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#0f172a">${escapeXml(line.slice(0, 60))}</text>`
          )
          .join("\n");
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e0f2fe"/><stop offset="100%" stop-color="#fae8ff"/></linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <rect x="80" y="80" width="920" height="920" rx="48" fill="#ffffff" fill-opacity="0.92"/>
  <text x="540" y="200" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#7c3aed">U Learn</text>
  ${textEls}
</svg>`;
      }

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
    // Prefer download URL for large artifacts (avoids proxy body limits on base64 JSON).
    const includeInline =
      !job.resultContent || job.resultContent.length < 400_000;
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
