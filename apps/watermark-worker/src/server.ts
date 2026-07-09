import { createHash } from "crypto";
import { spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import express from "express";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.WATERMARK_SERVICE_SECRET || "";
const BUCKET = process.env.R2_BUCKET || "ulearn";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadObjectToFile(key: string, destPath: string) {
  const response = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!response.Body) throw new Error("EMPTY_OBJECT");
  await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(destPath));
}

async function uploadFileFromPath(key: string, filePath: string, contentType: string) {
  const size = (await stat(filePath)).size;
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
    })
  );
}

async function burnWatermark(inputPath: string, outputPath: string, watermark: string) {
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

function cacheKeyFor(userId: string, sourceKey: string, scope: string) {
  const hash = createHash("sha256").update(`${userId}:${sourceKey}`).digest("hex").slice(0, 20);
  return `watermarked/${scope}/${hash}.mp4`;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/v1/watermark", async (req, res) => {
  if (!SECRET || req.headers.authorization !== `Bearer ${SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { userId, sourceKey, scope, watermark } = req.body ?? {};
  if (!userId || !sourceKey || !scope || !watermark) {
    res.status(422).json({ error: "Missing fields" });
    return;
  }

  const key = cacheKeyFor(userId, sourceKey, scope);
  try {
    if (await objectExists(key)) {
      res.json({ key, cached: true });
      return;
    }

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ulearn-wm-"));
    const inputPath = path.join(tmpDir, "source.mp4");
    const outputPath = path.join(tmpDir, "watermarked.mp4");
    try {
      await downloadObjectToFile(sourceKey, inputPath);
      await burnWatermark(inputPath, outputPath, watermark);
      await uploadFileFromPath(key, outputPath, "video/mp4");
      res.json({ key, cached: false });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("watermark failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Watermark failed" });
  }
});

app.listen(PORT, () => {
  console.log(`watermark worker listening on ${PORT}`);
});
