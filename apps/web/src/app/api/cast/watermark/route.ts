import { NextRequest } from "next/server";

/** WebVTT subtitle track for Chromecast viewer watermarking on external TVs. */
export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get("text") || "U Learn Viewer")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 160);

  const vtt = `WEBVTT

STYLE
::cue {
  color: #FFC107;
  background-color: rgba(0, 0, 0, 0.78);
  font-size: 5vmin;
  font-weight: bold;
  line-height: 1.3;
}

00:00:00.000 --> 99:59:59.999 line:88% position:50% align:center size:85%
${text}
`;

  return new Response(vtt, {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
