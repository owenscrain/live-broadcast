"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMS, CAMS_REFRESH_MS, camFrame, camPlayerVars, type Cam, type LiveCamsResponse } from "@/lib/cams";
import { DEFAULT_SETTINGS, turnAt, type Settings, type SettingsResponse } from "@/lib/settings";
import { YT_PLAYING, loadYouTubeApi, type YTPlayer } from "@/lib/youtube-player";

/** A six-pointed star, as on the Chicago flag, on a 100 x 100 grid. */
const FLAG_STAR = "50.0,0.0 61.0,30.9 93.3,25.0 72.0,50.0 93.3,75.0 61.0,69.1 50.0,100.0 39.0,69.1 6.7,75.0 28.0,50.0 6.7,25.0 39.0,30.9";

/** The cam must be playing within this long of loading (the Fire TV Stick is slow to start)... */
const START_MS = 30_000;
/** ...and its picture can't stop moving for longer than this. */
const STALL_MS = 15_000;
/** How often the player is checked. */
const CHECK_MS = 3_000;
/** After a failure, the "offline" note shows this long, then the cam is tried again. */
const RETRY_MS = 2 * 60_000;
/** How often the screen checks for new settings from /controller. */
const SETTINGS_REFRESH_MS = 60_000;
/** The next cam's player starts this long before its turn, so it's already playing when it's shown... */
const PRELOAD_MS = 10_000;
/** ...and the last one stays under it this long, while the new one fades in. */
const FADE_MS = 1_500;

const STATE_NAMES: Record<number, string> = { [-1]: "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };
/** Unstarted, paused or cued: the states a "play" nudge is for. */
const STOPPED = new Set([-1, 2, 5]);

const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

type PlayerStatus = { state: number; time: number; quality: string };

/** The window and current player's sizes, for the diagnostics panel. */
function layoutNote(): string {
  const box = document.querySelector(".live-cams__cam--current .live-cams__box");
  const frame = document.querySelector(".live-cams__cam--current iframe")?.getBoundingClientRect();
  return `window ${innerWidth}x${innerHeight} @${devicePixelRatio} · box ${box ? `${box.clientWidth}x${box.clientHeight}` : "-"} · player ${frame ? `${Math.round(frame.left)},${Math.round(frame.top)} ${Math.round(frame.width)}x${Math.round(frame.height)}` : "-"}`;
}

/**
 * The cam's YouTube player (muted, no controls), drawn big enough to cover its box, framed by the
 * cam's crop. It asks to play every few seconds until it does (a slow device can miss the first
 * request), and reports a failure if it isn't playing within 30 seconds, its picture stops moving
 * for 15, or YouTube reports an error.
 */
function CamPlayer({
  cam,
  onPlaying,
  onFail,
  onStatus,
}: {
  cam: Cam;
  onPlaying: (playing: boolean) => void;
  onFail: (reason: string) => void;
  onStatus: (status: PlayerStatus) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onPlaying, onFail, onStatus });
  callbacks.current = { onPlaying, onFail, onStatus };

  // The box's size, to place the player in it.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const target = document.createElement("div");
    holder.current?.appendChild(target);
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(target, {
        host: "https://www.youtube-nocookie.com",
        videoId: cam.videoId,
        playerVars: camPlayerVars(window.location.origin),
        events: {
          onReady: () => {
            if (cancelled) return;
            player.current?.mute();
            setReady(true);
          },
          onStateChange: (e) => callbacks.current.onPlaying(e.data === YT_PLAYING),
          onError: (e) => callbacks.current.onFail(`YouTube error ${e.data}`),
        },
      });
    });
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      target.remove();
    };
  }, [cam.videoId]);

  // Keep it playing, and make sure it really is.
  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    const since = Date.now();
    let lastTime = -1;
    let movedAt = 0;
    const id = setInterval(() => {
      const state = p.getPlayerState();
      const time = p.getCurrentTime();
      callbacks.current.onStatus({ state, time: Math.round(time), quality: p.getPlaybackQuality?.() || "?" });
      if (state === YT_PLAYING && time !== lastTime) movedAt = Date.now();
      lastTime = time;
      // Only when it's stopped: asking again while it's buffering can restart the load.
      if (STOPPED.has(state)) {
        p.mute();
        p.playVideo();
      }
      if (!movedAt && Date.now() - since > START_MS) callbacks.current.onFail(`didn't start (state ${state})`);
      else if (movedAt && Date.now() - movedAt > STALL_MS) callbacks.current.onFail("picture stalled");
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [ready]);

  return (
    <div className="live-cams__box" ref={box} title={cam.label}>
      <div className="live-cams__player" ref={holder} style={camFrame(cam, size.width, size.height)} />
    </div>
  );
}

/**
 * The whole screen: a live cam covering everything above the CHICAGO LIVE bar (the picture cropped
 * to fit). The cams switched on take turns (a minute each to start with; ?cam= picks one instead).
 * The next cam's player starts, hidden, 10 seconds before its turn, so it's already playing when it
 * fades in over the last one (?preload=0 turns that off). If a cam fails, an "offline" note shows
 * in its turns for 2 minutes and then it's tried again. A stream that follows its channel is looked
 * up through /api/live-cams (every 10 minutes, and after a failure), since a restarted stream comes
 * back under a new video ID. Under the video, the dark blue CHICAGO LIVE bar, with a pulsing
 * Chicago-flag star, the cam's name and the time. ?debug=1 shows a diagnostics panel.
 */
export function LiveCams() {
  const [params, setParams] = useState<{ cam: string | null; debug: boolean; preload: boolean } | null>(null);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setParams({ cam: search.get("cam"), debug: search.has("debug"), preload: search.get("preload") !== "0" });
  }, []);

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // What /controller saved, checked every minute. If it can't be had at first, the built-in cams.
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/settings", { cache: "no-store" })
        .then((r) => r.json() as Promise<SettingsResponse>)
        .then((res) => setSettings((s) => (res.ok ? res.settings : s ?? DEFAULT_SETTINGS)))
        .catch(() => setSettings((s) => s ?? DEFAULT_SETTINGS));
    load();
    const id = setInterval(load, SETTINGS_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // The cam on screen, the one warming up for the next turn, and (just after a switch) the one fading out under it.
  const picked = params?.cam ? (settings?.cams ?? CAMS).find((c) => c.id === params.cam) ?? CAMS.find((c) => c.id === params.cam) : null;
  const turn = picked ? { cam: picked, next: null, msLeft: Infinity } : settings && now !== null ? turnAt(settings, now) : null;
  const before = !picked && settings && now !== null ? turnAt(settings, now - FADE_MS)?.cam : null;
  const previous = before && before.id !== turn?.cam.id ? before : null;
  const upcoming = params?.preload && turn?.next && turn.msLeft <= PRELOAD_MS ? turn.next : null;

  // Each followed channel's current stream, looked up together.
  const channels = [...new Set((picked ? [picked] : settings?.cams.filter((c) => c.on) ?? []).filter((c) => c.followChannel !== false).map((c) => c.channelId))].join(",");
  const [currentIds, setCurrentIds] = useState<Record<string, string | null>>({});
  const lookUp = useCallback(async () => {
    if (!channels) return;
    try {
      const res = (await fetch(`/api/live-cams?channels=${channels}`).then((r) => r.json())) as LiveCamsResponse;
      if (res.ok) setCurrentIds((ids) => ({ ...ids, ...res.streams }));
    } catch {
      // Keep the streams we have.
    }
  }, [channels]);
  useEffect(() => {
    lookUp();
    const id = setInterval(lookUp, CAMS_REFRESH_MS);
    return () => clearInterval(id);
  }, [lookUp]);
  const withStream = (c: Cam): Cam => ({ ...c, videoId: (c.followChannel !== false && currentIds[c.channelId]) || c.videoId });

  const [playing, setPlaying] = useState<Record<string, true>>({});
  const [failedAt, setFailedAt] = useState<Record<string, number>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const offline = (c: Cam) => failedAt[c.id] !== undefined && (now ?? 0) - failedAt[c.id] < RETRY_MS;
  const keyOf = (c: Cam) => `${c.id}:${withStream(c).videoId}:${attempts[c.id] ?? 0}`;
  const onFail = useCallback(
    (c: Cam, key: string, reason: string) => {
      setEvents((e) => [`${new Date().toLocaleTimeString()} ${c.shortLabel} ${reason}`, ...e].slice(0, 5));
      setPlaying(({ [key]: _, ...rest }) => rest);
      setFailedAt((f) => (c.id in f ? f : { ...f, [c.id]: Date.now() }));
      lookUp();
    },
    [lookUp],
  );
  // After a failure, try again in a couple of minutes, with a fresh player.
  useEffect(() => {
    const due = Object.entries(failedAt).filter(([, at]) => (now ?? 0) - at >= RETRY_MS);
    if (due.length === 0) return;
    setFailedAt((f) => Object.fromEntries(Object.entries(f).filter(([id]) => !due.some(([d]) => d === id))));
    setAttempts((a) => ({ ...a, ...Object.fromEntries(due.map(([id]) => [id, (a[id] ?? 0) + 1])) }));
  }, [failedAt, now]);

  // Oldest first, which is also the order they were started in, so React never moves one (moving an iframe reloads it).
  const players = [previous, turn?.cam, upcoming].filter((c, i, all): c is Cam => !!c && !offline(c) && all.findIndex((o) => o?.id === c.id) === i);
  const playerKeys = players.map(keyOf).join(" ");
  // Forget players that are gone (the screen runs for weeks).
  useEffect(() => {
    const live = new Set(playerKeys.split(" "));
    setPlaying((p) => (Object.keys(p).every((k) => live.has(k)) ? p : Object.fromEntries(Object.entries(p).filter(([k]) => live.has(k)))));
  }, [playerKeys]);

  if (now === null || !params || (!settings && !picked)) return <div className="live-cams" />;
  const cam = turn ? withStream(turn.cam) : null;
  const shown = (c: Cam) => !!playing[keyOf(c)] && (c.id === turn?.cam.id || c.id === previous?.id);
  return (
    <div className="live-cams" aria-label={cam ? `Live cam: ${cam.label}` : "Live cams off"}>
      <div className="live-cams__screen">
        {cam && offline(cam) && <p className="live-cams__offline">The live cam is offline right now.</p>}
        {!cam && <p className="live-cams__offline">No live cam is turned on.</p>}
        {players.map((c) => {
          const key = keyOf(c);
          const current = c.id === turn?.cam.id;
          return (
            <div key={key} className={`live-cams__cam${shown(c) ? " live-cams__cam--shown" : ""}${current ? " live-cams__cam--current" : ""}`}>
              <CamPlayer
                cam={withStream(c)}
                onPlaying={(isPlaying) => isPlaying && setPlaying((p) => (p[key] ? p : { ...p, [key]: true }))}
                onFail={(reason) => onFail(c, key, reason)}
                onStatus={(s) => current && setStatus(s)}
              />
            </div>
          );
        })}
        {params.debug && (
          <pre className="live-cams__debug">
            {cam
              ? `${cam.shortLabel} ${cam.videoId}${playing[keyOf(cam)] ? " SHOWN" : ""} ${status ? `${STATE_NAMES[status.state] ?? status.state} t=${status.time} ${status.quality}` : "not ready"}${offline(cam) ? " OFFLINE" : ""}`
              : "no stream on"}
            {turn?.next ? ` · next ${turn.next.shortLabel} in ${Math.ceil(turn.msLeft / 1000)}s${upcoming ? (playing[keyOf(upcoming)] ? " (ready)" : " (loading)") : ""}` : ""}
            {"\n"}
            {layoutNote()}
            {"\n"}
            {events.join("\n") || "no failures"}
            {"\n"}
            {navigator.userAgent}
          </pre>
        )}
      </div>
      <div className="live-cams__label">
        <svg className="live-cams__star" viewBox="0 0 100 100" aria-hidden="true">
          <polygon points={FLAG_STAR} />
        </svg>
        <span className="live-cams__title">CHICAGO LIVE</span>
        {cam && (
          <span className="live-cams__name fade-in" key={cam.shortLabel}>
            {cam.shortLabel}
          </span>
        )}
        <span className="live-cams__time">{CLOCK.format(now)}</span>
      </div>
    </div>
  );
}
