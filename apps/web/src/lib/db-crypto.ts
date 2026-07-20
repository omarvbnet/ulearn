import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function keyFromSecret(): Buffer {
  const secret =
    process.env.DB_PROVIDER_SECRET ||
    process.env.JWT_SECRET ||
    "ulearn-dev-secret-change-in-production";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a connection string for storage in SystemSetting / backups. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFromSecret(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value previously produced by encryptSecret. Plain values pass through. */
export function decryptSecret(value: string): string {
  if (!value.startsWith("enc:v1:")) return value;
  const parts = value.split(":");
  if (parts.length !== 5) throw new Error("Invalid encrypted secret");
  const [, , ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGO, keyFromSecret(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskConnectionUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^prisma\+postgres:/, "postgres:").replace(/^prisma:/, "https:"));
    if (u.password) u.password = "***";
    if (u.username && u.username.length > 4) {
      u.username = `${u.username.slice(0, 2)}***`;
    }
    return u.toString().replace(/^https:/, url.startsWith("prisma:") ? "prisma:" : "https:");
  } catch {
    return url.replace(/:[^:@/]+@/, ":***@");
  }
}
