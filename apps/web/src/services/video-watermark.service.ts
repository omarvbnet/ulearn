import { createHash } from "crypto";
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  downloadObjectToFile,
  getDownloadUrl,
  objectExists,
  uploadFileFromPath,
} from "@/lib/r2";
import { CourseService } from "@/services/course.service";

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

export function viewerWatermarkText(user: {
  fullLegalName: string | null;
  nationalId: string | null;
  phone: string;
}): string {
  const name = user.fullLegalName?.trim();
  const id = user.nationalId?.trim();
  const phone = user.phone.trim();
  const display = name || phone || "U Learn Viewer";
  if (id) return `${display} · ID: ${id}`;
  if (phone && phone !== display) return `${display} · ${phone}`;
  return display;
}

function cacheKeyFor(userId: string, sourceKey: string, scope: string) {
  const hash = createHash("sha256").update(`${userId}:${sourceKey}`).digest("hex").slice(0, 20);
  return `watermarked/${scope}/${hash}.mp4`;
}

async function ffmpegAvailable(): Promise<boolean> {
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

async function burnWatermarkLocal(inputPath: string, outputPath: string, watermark: string) {
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  const text = escapeDrawtext(watermark.slice(0, 120));
  const vf =
    "drawtext=" +
    `text='${text}'` +
    ":fontcolor=yellow@0.95" +
    ":fontsize=30" +
    ":box=1:boxcolor=black@0.65:boxborderw=10" +
    ":x=(w-text_w)/2" +
    ":y=if(lt(mod(t\\,12)\\,4)\\,h*0.12\\,if(lt(mod(t\\,12)\\,8)\\,h*0.5\\,h*0.82))" +
    ":expansion=none";

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      process.env.FFMPEG_PRESET || "veryfast",
      "-crf",
      process.env.FFMPEG_CRF || "23",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg failed (${code})`));
    });
  });
}

async function ensureWatermarkedFileLocal(params: {
  userId: string;
  sourceKey: string;
  scope: string;
  watermark: string;
}): Promise<{ key: string; cached: boolean }> {
  const key = cacheKeyFor(params.userId, params.sourceKey, params.scope);
  if (await objectExists(key)) {
    return { key, cached: true };
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ulearn-wm-"));
  const inputPath = path.join(tmpDir, "source.mp4");
  const outputPath = path.join(tmpDir, "watermarked.mp4");
  try {
    await downloadObjectToFile(params.sourceKey, inputPath);
    await burnWatermarkLocal(inputPath, outputPath, params.watermark);
    await uploadFileFromPath(key, outputPath, "video/mp4");
    return { key, cached: false };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Calls the external ffmpeg worker (Railway/Fly). Required on Vercel. */
async function ensureWatermarkedFileRemote(params: {
  userId: string;
  sourceKey: string;
  scope: string;
  watermark: string;
}): Promise<{ key: string; cached: boolean }> {
  const base = process.env.WATERMARK_SERVICE_URL?.replace(/\/$/, "");
  const secret = process.env.WATERMARK_SERVICE_SECRET;
  if (!base || !secret) {
    throw new Error("WATERMARK_WORKER_NOT_CONFIGURED");
  }

  const key = cacheKeyFor(params.userId, params.sourceKey, params.scope);
  if (await objectExists(key)) {
    return { key, cached: true };
  }

  const res = await fetch(`${base}/v1/watermark`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      userId: params.userId,
      sourceKey: params.sourceKey,
      scope: params.scope,
      watermark: params.watermark,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Worker failed (${res.status})`);
  }

  const data = (await res.json()) as { key?: string; cached?: boolean };
  if (!data.key) throw new Error("Worker returned no key");
  return { key: data.key, cached: data.cached === true };
}

async function ensureWatermarkedFile(params: {
  userId: string;
  sourceKey: string;
  scope: string;
  watermark: string;
}): Promise<{ key: string; cached: boolean }> {
  if (process.env.WATERMARK_SERVICE_URL) {
    return ensureWatermarkedFileRemote(params);
  }
  if (!(await ffmpegAvailable())) {
    throw new Error("FFMPEG_UNAVAILABLE");
  }
  return ensureWatermarkedFileLocal(params);
}

export class VideoWatermarkService {
  static async getStoreLessonWatermarkedUrl(userId: string, lessonId: string) {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id: lessonId, course: { deletedAt: null } },
      include: {
        course: { select: { id: true, price: true, teacher: { select: { userId: true } } } },
      },
    });
    if (!lesson?.fileKey) return { ok: false as const, error: "NOT_FOUND" };

    const purchased = await prisma.coursePurchase.findFirst({
      where: { userId, courseId: lesson.courseId, status: "PAID" },
    });
    const isOwner = lesson.course.teacher.userId === userId;
    const isFree = lesson.course.price <= 0 || lesson.isFreePreview;
    if (!purchased && !isFree && !isOwner) {
      return { ok: false as const, error: "NO_ACCESS" };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullLegalName: true, nationalId: true, phone: true },
    });
    if (!user) return { ok: false as const, error: "UNAUTHORIZED" };

    const watermark = viewerWatermarkText(user);
    try {
      const { key, cached } = await ensureWatermarkedFile({
        userId,
        sourceKey: lesson.fileKey,
        scope: `store-${lessonId}`,
        watermark,
      });
      const url = await getDownloadUrl(key, 6 * 3600);
      return { ok: true as const, url, cached, watermark };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("FFMPEG_UNAVAILABLE") || msg.includes("WATERMARK_WORKER_NOT_CONFIGURED")) {
        return { ok: false as const, error: "WATERMARK_UNAVAILABLE" };
      }
      throw e;
    }
  }

  static async getCurriculumLessonWatermarkedUrl(
    userId: string,
    lessonId: string,
    contentId?: string
  ) {
    const result = await CourseService.getLesson(lessonId, userId);
    if (!result || !result.hasAccess) return { ok: false as const, error: "NO_ACCESS" };

    const video =
      result.lesson.contents.find((c) => c.id === contentId && c.type === "VIDEO") ??
      result.lesson.contents.find((c) => c.type === "VIDEO");
    if (!video?.fileKey) return { ok: false as const, error: "NOT_FOUND" };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullLegalName: true, nationalId: true, phone: true },
    });
    if (!user) return { ok: false as const, error: "UNAUTHORIZED" };

    const watermark = viewerWatermarkText(user);
    try {
      const { key, cached } = await ensureWatermarkedFile({
        userId,
        sourceKey: video.fileKey,
        scope: `lesson-${lessonId}-${video.id}`,
        watermark,
      });
      const url = await getDownloadUrl(key, 6 * 3600);
      return { ok: true as const, url, cached, watermark };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("FFMPEG_UNAVAILABLE") || msg.includes("WATERMARK_WORKER_NOT_CONFIGURED")) {
        return { ok: false as const, error: "WATERMARK_UNAVAILABLE" };
      }
      throw e;
    }
  }
}
