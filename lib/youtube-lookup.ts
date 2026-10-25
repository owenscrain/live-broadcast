import { isChannelId } from "./cams";

const PAGE = { headers: { "Accept-Language": "en-US" }, next: { revalidate: 600 } } as const;

/**
 * A channel's current live stream (server only). Live streams that restart come back under a new
 * video ID, and YouTube's channel-wide live embed no longer plays, so the board looks it up: the
 * channel's "live" page points at its stream while it's on; otherwise its latest stream. Null if
 * neither turns one up. Each page is fetched at most every 10 minutes, however many screens ask.
 */
export async function currentStream(channelId: string): Promise<string | null> {
  if (!isChannelId(channelId)) return null;
  const live = await fetch(`https://www.youtube.com/channel/${channelId}/live`, PAGE).then((r) => (r.ok ? r.text() : ""));
  const onAir = live.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  if (onAir) return onAir[1];
  const streams = await fetch(`https://www.youtube.com/channel/${channelId}/streams`, PAGE).then((r) => (r.ok ? r.text() : ""));
  return streams.match(/"videoId":"([\w-]{11})"/)?.[1] ?? null;
}

/**
 * What YouTube says about a video: its title, and its channel. Null if it doesn't exist or can't be
 * embedded on other sites (YouTube's oEmbed answers neither).
 */
export async function videoInfo(videoId: string): Promise<{ title: string; channelId: string } | null> {
  const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
  if (!oembed.ok) return null;
  const { title } = (await oembed.json()) as { title?: string };
  const page = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: { "Accept-Language": "en-US" } }).then((r) => (r.ok ? r.text() : ""));
  const channelId = page.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
  return channelId && isChannelId(channelId) ? { title: title ?? "Live stream", channelId } : null;
}
