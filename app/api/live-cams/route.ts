import { NextResponse } from "next/server";
import { isChannelId } from "@/lib/cams";
import { currentStream } from "@/lib/youtube-lookup";

export const runtime = "nodejs";


/** ?channels=UC…,UC…: each channel's current live stream (null where none was found). */
export async function GET(request: Request) {
  const channels = (new URL(request.url).searchParams.get("channels") ?? "").split(",").filter(isChannelId).slice(0, 8);
  const entries = await Promise.all(channels.map(async (c) => [c, await currentStream(c).catch(() => null)] as const));
  return NextResponse.json({ ok: true, streams: Object.fromEntries(entries) }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } });
}
