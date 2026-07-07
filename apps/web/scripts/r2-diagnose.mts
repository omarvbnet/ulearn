/** Diagnoses R2 connectivity, presigned uploads, and CORS. */
import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});
const bucket = process.env.R2_BUCKET || "ulearn";

console.log("Endpoint:", process.env.R2_ENDPOINT);
console.log("Bucket:", bucket);

// 1. Server-side PUT (validates credentials + bucket)
try {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "diagnostics/test.txt",
      Body: "hello",
      ContentType: "text/plain",
    })
  );
  console.log("1. Server-side PUT: OK");
} catch (e) {
  console.log("1. Server-side PUT FAILED:", (e as Error).name, (e as Error).message);
}

// 2. Presigned URL PUT (same mechanism the browser uses, minus CORS)
try {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: "diagnostics/presigned.txt",
    ContentType: "text/plain",
  });
  const url = await getSignedUrl(r2, cmd, { expiresIn: 300 });
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: "presigned hello",
  });
  console.log("2. Presigned PUT:", res.ok ? "OK" : `FAILED HTTP ${res.status}: ${await res.text()}`);
} catch (e) {
  console.log("2. Presigned PUT FAILED:", (e as Error).message);
}

// 3. CORS configuration (required for browser uploads)
try {
  const cors = await r2.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log("3. CORS rules:", JSON.stringify(cors.CORSRules, null, 2));
} catch (e) {
  console.log("3. CORS check FAILED:", (e as Error).name, "-", (e as Error).message);
}

// 4. Browser-style CORS preflight (what the browser actually does)
try {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: "diagnostics/preflight.txt",
    ContentType: "text/plain",
  });
  const url = await getSignedUrl(r2, cmd, { expiresIn: 300 });
  const res = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const allow = res.headers.get("access-control-allow-origin");
  console.log(
    `4. CORS preflight: HTTP ${res.status}, Access-Control-Allow-Origin: ${allow ?? "(none)"}`
  );
  console.log(
    allow
      ? "   → Browser uploads should work"
      : "   → BROWSER UPLOADS WILL FAIL: no CORS rules on the bucket"
  );
} catch (e) {
  console.log("4. Preflight FAILED:", (e as Error).message);
}
