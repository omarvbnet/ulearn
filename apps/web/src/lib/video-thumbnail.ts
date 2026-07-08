/** Capture a JPEG frame from a local video file (client-side cover generation). */
export async function captureVideoThumbnail(
  file: File,
  seekRatio = 0.12,
): Promise<{ blob: Blob; durationSec: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read video metadata"));
    });

    const durationSec = Number.isFinite(video.duration)
      ? Math.round(video.duration)
      : 0;
    const target = Math.max(0.5, (video.duration || 10) * seekRatio);

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = target;
      video.onerror = () => reject(new Error("Could not seek video"));
    });

    const canvas = document.createElement("canvas");
    const w = Math.min(1280, video.videoWidth || 640);
    const h = Math.round(w * ((video.videoHeight || 360) / (video.videoWidth || 640)));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(video, 0, 0, w, h);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Thumbnail encode failed"))),
        "image/jpeg",
        0.82,
      );
    });

    return { blob, durationSec };
  } finally {
    URL.revokeObjectURL(url);
  }
}
