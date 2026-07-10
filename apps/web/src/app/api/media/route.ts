import { error } from "@/lib/api";
import { getDownloadUrl } from "@/lib/r2";

const PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

/**
 * Same-origin media gateway. Clients (Flutter + admin) load `/api/media?key=...`
 * and we redirect to the public CDN or a fresh signed R2 URL.
 * This repairs historical `/uploads/...` rows that never existed on the Next host.
 */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key")?.trim() || "";
  if (!key || key.includes("..") || key.startsWith("/")) {
    return error("Invalid key", 422, "VALIDATION");
  }

  if (PUBLIC_URL) {
    return Response.redirect(`${PUBLIC_URL}/${key}`, 302);
  }

  if (r2Configured) {
    try {
      const signed = await getDownloadUrl(key, 60 * 60);
      return Response.redirect(signed, 302);
    } catch {
      return error("Media not found", 404, "NOT_FOUND");
    }
  }

  // Local/dev: files live under public/uploads.
  return Response.redirect(new URL(`/uploads/${key}`, request.url), 302);
}
