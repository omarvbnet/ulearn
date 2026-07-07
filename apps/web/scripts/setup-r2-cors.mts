/**
 * Configures CORS on the R2 bucket so browsers can upload directly
 * via presigned URLs. Run with: npx tsx scripts/setup-r2-cors.mts
 */
import "dotenv/config";
import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const bucket = process.env.R2_BUCKET || "ulearn";

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
];

try {
  const existing = await r2.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log("Current CORS rules:", JSON.stringify(existing.CORSRules, null, 2));
} catch {
  console.log("No CORS configuration found on bucket — adding one.");
}

await r2.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [...new Set(allowedOrigins)],
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  })
);

const updated = await r2.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log("CORS configured successfully:");
console.log(JSON.stringify(updated.CORSRules, null, 2));
