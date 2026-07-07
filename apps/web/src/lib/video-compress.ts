"use client";

/**
 * Browser-side video compression using WebCodecs (via mediabunny).
 * Re-encodes to H.264/AAC MP4, capped at 1080p, before uploading —
 * hardware-accelerated, so it's fast and keeps storage/bandwidth low.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

/** Files below this size are uploaded as-is; compression wouldn't pay off. */
const MIN_COMPRESS_BYTES = 30 * 1024 * 1024; // 30 MB

const MAX_HEIGHT = 1080;
const VIDEO_BITRATE = 2_500_000; // 2.5 Mbps — good quality for lectures
const AUDIO_BITRATE = 128_000;

export type CompressResult = {
  file: File;
  /** True when the original file was kept (too small, unsupported, or compression didn't help). */
  skipped: boolean;
  originalBytes: number;
  finalBytes: number;
};

export function isCompressionSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
}

export async function compressVideo(
  file: File,
  onProgress?: (pct: number) => void
): Promise<CompressResult> {
  const keepOriginal = (): CompressResult => ({
    file,
    skipped: true,
    originalBytes: file.size,
    finalBytes: file.size,
  });

  if (file.size < MIN_COMPRESS_BYTES || !isCompressionSupported()) {
    return keepOriginal();
  }

  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: async (track) => ({
        codec: "avc",
        // Clamp to 1080p without upscaling smaller videos.
        height: Math.min(await track.getDisplayHeight(), MAX_HEIGHT),
        bitrate: VIDEO_BITRATE,
      }),
      audio: { codec: "aac", bitrate: AUDIO_BITRATE },
    });

    if (!conversion.isValid) return keepOriginal();

    conversion.onProgress = (p) => onProgress?.(Math.round(p * 100));
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength >= file.size) {
      // Compression failed or didn't reduce size — upload the original.
      return keepOriginal();
    }

    const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
    const compressed = new File([buffer], name, { type: "video/mp4" });
    return {
      file: compressed,
      skipped: false,
      originalBytes: file.size,
      finalBytes: compressed.size,
    };
  } catch {
    return keepOriginal();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
