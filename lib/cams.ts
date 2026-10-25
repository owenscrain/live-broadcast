/**
 * The live cams: public live streams on YouTube, each embedded with YouTube's own player (muted, no
 * controls), so the video streams from YouTube straight to the screen (no Vercel usage). The list
 * is managed on /controller; these are the streams it starts with.
 */
export type Cam = {
  /** Its short ID, for ?cam= ("river"). */
  id: string;
  /** Its full name ("Chicago River"). */
  label: string;
  /** Its name on the CHICAGO LIVE bar ("River"). */
  shortLabel: string;
  /** The stream's YouTube video ID, the last one known (a restarted stream gets a new one, found through the channel). */
  videoId: string;
  channelId: string;
  /**
   * Whether to follow the channel to its current stream when this one restarts. Off for channels
   * that run several cams at once (the channel's main stream would be a different cam), so those
   * stay on this video. On when missing.
   */
  followChannel?: boolean;
  /**
   * How it's framed: the share of the picture cut off the top (0.13 when missing, where some cams
   * draw their own banner) and the point across the picture kept in the middle (0 left edge, 1 right
   * edge; 0.5 when missing). Cutting more off the top zooms in.
   */
  crop?: { top?: number; centerX?: number };
  /** Shown on screen (several take turns). */
  on: boolean;
};

/** The streams the controller starts with, until its first save. */
export const CAMS: Cam[] = [
  { id: "river", label: "Chicago River", shortLabel: "River", videoId: "1hAugar3D9k", channelId: "UCj0wW84FJvt3i_gAI8RdRkg", on: true },
  // StreamTime Live runs many cams at once, so this one stays on its own video.
  // Framed from the left of the picture, so the start of runway 31R is in view.
  {
    id: "midway",
    label: "Midway Airport",
    shortLabel: "MDW",
    videoId: "67BCsiW-1Io",
    channelId: "UCrtIIVfi-5tMlVXdMDzOMUA",
    followChannel: false,
    crop: { top: 0.13, centerX: 0.287 },
    on: true,
  },
];

/** How much of the top of each picture is cut off by default, and the default point kept in the middle. */
export const DEFAULT_CROP = { top: 0.13, centerX: 0.5 };

/**
 * Where a cam's player sits in a `width` x `height` space, in pixels, covering all of it: tall
 * enough that `top` of the picture is cut off above and the rest fills the height, or wider if the
 * space is wider than that (then the bottom is cut too). It's placed so `centerX` of the way across
 * is in the middle, without leaving a gap at either side. Plain sizes and positions, no CSS
 * transforms: the Fire TV draws video at its unscaled size and place, ignoring a transform.
 */
export function camFrame(cam: Pick<Cam, "crop">, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const { top, centerX } = { ...DEFAULT_CROP, ...cam.crop };
  const w = Math.max((height / (1 - top)) * (16 / 9), width);
  const h = (w * 9) / 16;
  const left = Math.min(0, Math.max(width - w, width / 2 - centerX * w));
  return { left: Math.round(left), top: Math.round(-top * h), width: Math.round(w), height: Math.round(h) };
}

/** How often the screen asks for the cam's current stream. */
export const CAMS_REFRESH_MS = 10 * 60_000;

/** Each channel's current live stream (null if it couldn't be found), from /api/live-cams. */
export type LiveCamsResponse = { ok: true; streams: Record<string, string | null> } | { ok: false; error: string };

export const isChannelId = (value: unknown): value is string => typeof value === "string" && /^UC[\w-]{22}$/.test(value);

/** The player settings for a cam: autoplaying, muted, no controls, captions, related videos or keyboard. */
export function camPlayerVars(origin: string): Record<string, string | number> {
  return { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, origin, enablejsapi: 1 };
}

/** A YouTube video ID from a link ("watch?v=", "youtu.be/", "/live/", "/embed/", "/shorts/") or the bare ID. */
export function youTubeVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(url.hostname)) return null;
  const id = url.hostname.endsWith("youtu.be") ? url.pathname.slice(1) : url.searchParams.get("v") ?? url.pathname.match(/\/(?:live|embed|shorts)\/([\w-]{11})/)?.[1];
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
