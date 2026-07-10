import { serveR2Object } from "@/lib/media-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legacy query form: /api/media?key=ads/user/file.jpg */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key")?.trim() || "";
  return serveR2Object(key, request);
}
