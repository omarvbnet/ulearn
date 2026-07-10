import { serveR2Object } from "@/lib/media-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Path form: /api/media/ads/userId/file.jpg — preferred for Flutter image caches. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const parts = (await params).key ?? [];
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  return serveR2Object(key, request);
}
