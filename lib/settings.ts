import { CAMS, isChannelId, type Cam } from "./cams";

/**
 * What the controller (/controller) sets: the list of streams, which of them are shown, and how
 * long each shows when more than one is on. Saved as one Global Config item (see settings-store.ts).
 */
export type Settings = {
  cams: Cam[];
  /** When more than one cam is on, each shows this many minutes, then the next. */
  turnMinutes: number;
  /** Saves this month, to keep an eye on Global Config's 100 writes a month (shared with the CTA board). */
  writes?: { month: string; count: number };
};

export type SettingsResponse = { ok: true; settings: Settings; store: StoreStatus } | { ok: false; error: string };

export type StoreStatus = { persistent: boolean; writable: boolean; problem: string | null };

export const TURN_CHOICES = [1, 5, 10, 15, 30, 60];

export const DEFAULT_SETTINGS: Settings = { cams: CAMS, turnMinutes: 1 };

/** Room for this many streams. */
export const MAX_CAMS = 12;

/** The longest name that fits the CHICAGO LIVE bar beside the title and the clock. */
export const SHORT_LABEL_MAX = 14;

const isVideoId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{11}$/.test(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const between = (v: unknown, lo: number, hi: number) => typeof v === "number" && v >= lo && v <= hi;

/**
 * A cam as sent by the controller or read back from storage, or null if it isn't one. A built-in
 * cam (River, MDW) picks up any setting it doesn't have from lib/cams.ts, so its framing can be
 * tuned there after the list is saved.
 */
export function normalizeCam(value: unknown): Cam | null {
  const v = (value ?? {}) as Partial<Cam>;
  const id = text(v.id, 40);
  const shortLabel = text(v.shortLabel, SHORT_LABEL_MAX);
  if (!/^[\w-]+$/.test(id) || !shortLabel || !isVideoId(v.videoId) || !isChannelId(v.channelId)) return null;
  const built = CAMS.find((c) => c.id === id);
  const crop = v.crop ?? built?.crop;
  return {
    id,
    label: text(v.label, 120) || shortLabel,
    shortLabel,
    videoId: v.videoId,
    channelId: v.channelId,
    ...(v.followChannel === false || (v.followChannel === undefined && built?.followChannel === false) ? { followChannel: false } : {}),
    ...(crop && (crop.top === undefined || between(crop.top, 0, 0.5)) && (crop.centerX === undefined || between(crop.centerX, 0, 1))
      ? { crop: { ...(crop.top !== undefined && { top: crop.top }), ...(crop.centerX !== undefined && { centerX: crop.centerX }) } }
      : {}),
    on: v.on === true,
  };
}

/** Fills in anything missing and drops anything malformed, so stored or sent settings never break the screen. */
export function normalizeSettings(value: unknown): Settings {
  const v = (value ?? {}) as Partial<Settings>;
  const seen = new Set<string>();
  const cams = Array.isArray(v.cams)
    ? v.cams
        .map(normalizeCam)
        .filter((c): c is Cam => c !== null && !seen.has(c.id) && !!seen.add(c.id))
        .slice(0, MAX_CAMS)
    : DEFAULT_SETTINGS.cams;
  return {
    cams,
    turnMinutes: TURN_CHOICES.includes(v.turnMinutes as number) ? (v.turnMinutes as number) : DEFAULT_SETTINGS.turnMinutes,
    ...(v.writes && typeof v.writes.month === "string" && typeof v.writes.count === "number" ? { writes: v.writes } : {}),
  };
}

/**
 * The cam on screen at `now`: with several switched on, they take turns, `turnMinutes` each, by the
 * clock (so every screen shows the same one, and a reload doesn't start the turn over). Null if
 * none is on.
 */
export function camAt(settings: Settings, now: number): Cam | null {
  return turnAt(settings, now)?.cam ?? null;
}

/**
 * The turn at `now`: the cam on screen, the one after it (null if it's the only one on), and how
 * long until the switch. Null if none is on.
 */
export function turnAt(settings: Settings, now: number): { cam: Cam; next: Cam | null; msLeft: number } | null {
  const on = settings.cams.filter((c) => c.on);
  if (on.length === 0) return null;
  const turnMs = settings.turnMinutes * 60_000;
  const slot = Math.floor(now / turnMs);
  return { cam: on[slot % on.length], next: on.length > 1 ? on[(slot + 1) % on.length] : null, msLeft: turnMs - (now % turnMs) };
}

/** This month in Chicago, as "2026-10". */
export function monthKey(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}
