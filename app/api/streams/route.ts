import { NextResponse } from "next/server";
import { youTubeVideoId, type Cam } from "@/lib/cams";
import { SHORT_LABEL_MAX } from "@/lib/settings";
import { currentStream, videoInfo } from "@/lib/youtube-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StreamResponse = { ok: true; cam: Cam } | { ok: false; error: string };

const fail = (error: string, status = 400) => NextResponse.json<StreamResponse>({ ok: false, error }, { status });

/**
 * Look up a stream from a YouTube link, for the controller to add to its list (nothing is saved
 * until Save). Checks that YouTube allows it to be embedded, and whether it's its channel's main
 * stream: if so, the screen follows the channel when the stream restarts under a new ID.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown; shortLabel?: unknown } | null;
  const videoId = typeof body?.url === "string" ? youTubeVideoId(body.url) : null;
  if (!videoId) return fail("Paste a YouTube link to the live stream.");
  const shortLabel = typeof body?.shortLabel === "string" ? body.shortLabel.trim() : "";
  if (!shortLabel) return fail("Give it a name for the CHICAGO LIVE bar.");
  if (shortLabel.length > SHORT_LABEL_MAX) return fail(`Keep the name to ${SHORT_LABEL_MAX} characters so it fits the bar.`);
  const found = await videoInfo(videoId).catch(() => null);
  if (!found) return fail("YouTube couldn't find that video, or it can't be shown on other sites.");
  const followChannel = (await currentStream(found.channelId).catch(() => null)) === videoId;
  const id = `${shortLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cam"}-${videoId.slice(0, 4).toLowerCase()}`;
  return NextResponse.json<StreamResponse>({
    ok: true,
    cam: { id, label: found.title.slice(0, 120), shortLabel, videoId, channelId: found.channelId, ...(followChannel ? {} : { followChannel: false }), on: true },
  });
}
