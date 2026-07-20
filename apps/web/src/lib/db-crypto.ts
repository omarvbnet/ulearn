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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse postgres URLs even when the password has raw `@`, `:`, `#`, etc.
 * Uses last `@` as host separator and first `:` in userinfo as user/password split.
 */
function parsePostgresParts(s: string): {
  protocol: "postgres" | "postgresql";
  user: string;
  pass: string;
  host: string;
  port: string;
  path: string;
  search: string;
} {
  const protocol = /^postgres:\/\//i.test(s) ? "postgres" : "postgresql";
  const rest = s.replace(/^postgres(ql)?:\/\//i, "");
  const at = rest.lastIndexOf("@");
  if (at < 0) {
    throw new Error(
      "URL_MISSING_AT: Expected user:password@host. Example: postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres"
    );
  }

  const userinfo = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);
  const colon = userinfo.indexOf(":");
  const userRaw = colon < 0 ? userinfo : userinfo.slice(0, colon);
  const passRaw = colon < 0 ? "" : userinfo.slice(colon + 1);

  if (!userRaw) {
    throw new Error("URL_MISSING_USER: Username is empty (for Supabase Direct use postgres).");
  }
  if (!passRaw) {
    throw new Error(
      "URL_MISSING_PASSWORD: Password is empty. Replace [YOUR-PASSWORD] with the real DB password."
    );
  }

  const q = hostPart.indexOf("?");
  const beforeQuery = q < 0 ? hostPart : hostPart.slice(0, q);
  const search = q < 0 ? "" : hostPart.slice(q);
  const slash = beforeQuery.indexOf("/");
  const hostPort = slash < 0 ? beforeQuery : beforeQuery.slice(0, slash);
  const path = slash < 0 ? "/postgres" : beforeQuery.slice(slash) || "/postgres";

  if (!hostPort) {
    throw new Error("URL_MISSING_HOST: Host is empty.");
  }

  // host:port or [ipv6]:port
  let host: string;
  let port = "";
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end < 0) throw new Error("URL_INVALID_IPV6: Invalid IPv6 host brackets.");
    host = hostPort.slice(0, end + 1);
    const after = hostPort.slice(end + 1);
    if (after.startsWith(":")) port = after.slice(1);
  } else {
    const lastColon = hostPort.lastIndexOf(":");
    if (lastColon > 0 && /^\d+$/.test(hostPort.slice(lastColon + 1))) {
      host = hostPort.slice(0, lastColon);
      port = hostPort.slice(lastColon + 1);
    } else {
      host = hostPort;
    }
  }

  if (port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(
        `URL_INVALID_PORT: Port "${port}" is invalid. Check the host ends with :5432 (direct/session) or :6543 (pooler).`
      );
    }
  }

  return {
    protocol,
    user: safeDecode(userRaw),
    pass: safeDecode(passRaw),
    host,
    port,
    path: path.startsWith("/") ? path : `/${path}`,
    search,
  };
}

/**
 * Clean + validate a DB URL. Auto-encodes user/password so Prisma accepts
 * Supabase strings even when the password has @ : # / ? etc.
 */
export function normalizePostgresUrl(
  raw: string,
  opts?: NormalizePostgresOptions
): string {
  let s = raw.trim();
  // Strip wrapping quotes / backticks / accidental labels from copy-paste
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // "Direct postgresql://…" pasted from chat
  s = s.replace(/^(direct|pooler|session|transaction)\s+/i, "").trim();
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
    throw new Error(
      "URL_INVALID_PROTOCOL: Expected postgresql:// or postgres://. For Supabase copy Database → Connection string → URI."
    );
  }

  if (/\[YOUR-PASSWORD\]|YOUR_PASSWORD|<password>/i.test(s)) {
    throw new Error(
      "URL_PLACEHOLDER_PASSWORD: Replace [YOUR-PASSWORD] with your real database password."
    );
  }

  const parts = parsePostgresParts(s);
  const auth = `${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.pass)}@`;
  const hostPort = parts.port ? `${parts.host}:${parts.port}` : parts.host;
  return `${parts.protocol}://${auth}${hostPort}${parts.path}${parts.search}`;
}
