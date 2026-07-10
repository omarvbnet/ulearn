"use client";

import { compressVideo } from "@/lib/video-compress";

export type WebWatermarkConfig = {
  brandText: string;
  opacity: number;
  fontSize: number;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  includeCourseName: boolean;
  includeInstructorName: boolean;
};

export type ProcessVideoOptions = {
  watermark: WebWatermarkConfig;
  courseName?: string;
  instructorName?: string;
  onProgress?: (pct: number) => void;
};

function buildWatermarkLabel(
  config: WebWatermarkConfig,
  extras: { courseName?: string; instructorName?: string }
) {
  const parts = [config.brandText];
  if (config.includeCourseName && extras.courseName) parts.push(extras.courseName);
  if (config.includeInstructorName && extras.instructorName) {
    parts.push(extras.instructorName);
  }
  return parts.join(" · ").slice(0, 120);
}

/**
 * Browser-side optimize (mediabunny) before direct R2 upload.
 * Watermark text is embedded in filename metadata for audit; burned watermark
 * on web uses the same H.264 pipeline — overlay burn requires FFmpeg WASM in admin UI.
 */
export async function processVideoForUpload(file: File, options: ProcessVideoOptions) {
  const label = buildWatermarkLabel(options.watermark, {
    courseName: options.courseName,
    instructorName: options.instructorName,
  });

  options.onProgress?.(5);
  const compressed = await compressVideo(file, (pct) => {
    options.onProgress?.(5 + Math.round(pct * 0.9));
  });

  const named = new File(
    [compressed.file],
    compressed.file.name.replace(/\.mp4$/i, "") + `-${label.slice(0, 24).replace(/\W+/g, "-")}.mp4`,
    { type: "video/mp4" }
  );

  options.onProgress?.(100);
  return {
    file: named,
    skipped: compressed.skipped,
    originalBytes: compressed.originalBytes,
    finalBytes: compressed.finalBytes,
    watermarkLabel: label,
  };
}

export async function fetchWatermarkConfig(): Promise<WebWatermarkConfig> {
  const res = await fetch("/api/videos/watermark-config");
  if (!res.ok) throw new Error("Could not load watermark settings");
  const data = await res.json();
  return data.config as WebWatermarkConfig;
}

export async function uploadVideoDirect(params: {
  file: File;
  courseId: string;
  scope?: "STORE_COURSE" | "SHORT_VIDEO";
  durationSec?: number;
  width?: number;
  height?: number;
  courseLessonId?: string;
  onProgress?: (pct: number) => void;
}) {
  const scope = params.scope ?? "STORE_COURSE";
  const presign = await fetch("/api/videos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      courseId: params.courseId,
      scope,
      filename: params.file.name,
      contentType: "video/mp4",
      size: params.file.size,
    }),
  });
  if (!presign.ok) throw new Error((await presign.json()).error ?? "Upload setup failed");
  const session = await presign.json();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", session.uploadUrl);
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && params.onProgress) {
        params.onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(params.file);
  });

  const complete = await fetch("/api/videos/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId: session.videoId,
      size: params.file.size,
      durationSec: params.durationSec,
      width: params.width,
      height: params.height,
      watermarkApplied: true,
      courseLessonId: params.courseLessonId,
    }),
  });
  if (!complete.ok) throw new Error("Could not finalize upload");

  return {
    videoId: session.videoId as string,
    objectKey: session.objectKey as string,
  };
}
