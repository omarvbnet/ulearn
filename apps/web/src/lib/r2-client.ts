import { S3Client } from "@aws-sdk/client-s3";

export const R2_BUCKET = process.env.R2_BUCKET || "ulearn";

/**
 * Disable flexible checksums on signed GET URLs.
 * AWS SDK v3 defaults add `x-amz-checksum-mode=ENABLED`, which breaks many
 * mobile video players (fvp / ExoPlayer / AVPlayer) — they hang on loading.
 */
export const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
