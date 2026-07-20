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
    const normalized = normalizePostgresUrl(url, { allowAccelerate: true });
    const u = new URL(
      normalized
        .replace(/^prisma\+postgres:/i, "http:")
        .replace(/^prisma:/i, "http:")
        .replace(/^postgres(ql)?:/i, "http:")
    );
    if (u.password) u.password = "***";
    if (u.username && u.username.length > 4) {
      u.username = `${u.username.slice(0, 2)}***`;
    }
    const proto =
      normalized.match(/^(prisma\+postgres|prisma|postgres(?:ql)?):/i)?.[1] || "postgresql";
    return u.toString().replace(/^http:/i, `${proto}:`);
  } catch {
    return url.replace(/:[^:@/]+@/, ":***@");
  }
}

export type NormalizePostgresOptions = {
  /** Allow prisma:// / prisma+postgres:// (for masking / app runtime URL). */
  allowAccelerate?: boolean;
};

/**
 * Clean + validate a DB URL. Fixes common paste issues (quotes, whitespace)
 * and fails with a clear message when the password has unescaped special chars
 * (the usual cause of Prisma "invalid port number").
 */
export function normalizePostgresUrl(
  raw: string,
  opts?: NormalizePostgresOptions
): string {
  let s = raw.trim();
  // Strip wrapping quotes / backticks from copy-paste
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\r\n\t]+/g, "");

  if (!s) throw new Error("URL_EMPTY");

  const isAccel =
    s.startsWith("prisma://") ||
    s.startsWith("prisma+postgres://") ||
    s.includes("accelerate.prisma-data.net");
  const isPostgres = /^postgres(ql)?:\/\//i.test(s);

  if (isAccel) {
    if (!opts?.allowAccelerate) {
      throw new Error(
        "URL_MUST_BE_POSTGRES: Use postgresql:// for test/migrate (not prisma://)."
      );
    }
    return s;
  }

  if (!isPostgres) {
    throw new Error("URL_INVALID_PROTOCOL: Expected postgresql:// or postgres://");
  }

  if (/\[YOUR-PASSWORD\]|YOUR_PASSWORD|<password>/i.test(s)) {
    throw new Error(
      "URL_PLACEHOLDER_PASSWORD: Replace [YOUR-PASSWORD] with your real database password (URL-encoded)."
    );
  }

  const protocol = /^postgres:\/\//i.test(s) ? "postgres" : "postgresql";
  const afterScheme = s.replace(/^postgres(ql)?:\/\//i, "");
  const atCount = (afterScheme.match(/@/g) || []).length;
  if (atCount > 1) {
    throw new Error(
      "URL_UNESCAPED_AT: Found more than one @ in the connection string. Encode @ in the password as %40 so Prisma can parse host and port correctly."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(s.replace(/^postgres(ql)?:/i, "http:"));
  } catch {
    throw new Error(
      "URL_PARSE_FAILED: Connection string is malformed. If the password contains @ : # / ? % or spaces, URL-encode it (e.g. @ → %40, : → %3A, # → %23)."
    );
  }

  const port = parsed.port;
  if (port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(
        `URL_INVALID_PORT: Parsed port "${port}" is invalid. This usually means the password has unescaped special characters (@ : # / ?). Encode the password, e.g. postgresql://user:${"ENCODED_PASSWORD"}@host:5432/postgres`
      );
    }
  }

  if (!parsed.hostname) {
    throw new Error(
      "URL_MISSING_HOST: Could not parse host. Check user:password@host:port/db and encode special characters in the password."
    );
  }

  // Re-encode userinfo so Prisma always receives a legal URL
  const user = parsed.username ? decodeURIComponent(parsed.username) : "";
  const pass = parsed.password ? decodeURIComponent(parsed.password) : "";
  const auth =
    user || pass
      ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
      : "";

  const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/postgres";
  const search = parsed.search || "";
  return `${protocol}://${auth}${parsed.host}${path}${search}`;
}
