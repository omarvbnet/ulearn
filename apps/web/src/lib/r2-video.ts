import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getUploadUrl, validateFile, uploadExpiresIn } from "@/lib/r2";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";

export const VIDEO_PLAYBACK_EXPIRES_SEC = Number(process.env.VIDEO_PLAYBACK_EXPIRES_SEC || 600);

/** Single optimized MP4 delivery path — no HLS, no multi-bitrate. */
export function buildVideoDeliveryKey(courseId: string, videoId: string) {
  return `videos/${courseId}/${videoId}/delivery.mp4`;
}

export function buildShortVideoDeliveryKey(videoId: string) {
  return `videos/shorts/${videoId}/delivery.mp4`;
}

export async function getVideoUploadUrl(params: {
  key: string;
  contentType: string;
  size: number;
  filename: string;
}) {
  const validation = validateFile(params.contentType, params.size, "video", params.filename);
  if (!validation.valid) throw new Error(validation.error || "INVALID_FILE");

  const expiresIn = uploadExpiresIn("video", params.size);
  return getUploadUrl({
    key: params.key,
    contentType: params.contentType,
    category: "video",
    size: params.size,
    expiresIn,
  });
}

export async function headVideoObject(key: string) {
  const res = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return {
    size: Number(res.ContentLength ?? 0),
    contentType: res.ContentType ?? "video/mp4",
    etag: res.ETag?.replace(/"/g, ""),
  };
}
