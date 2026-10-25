"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMS, CAMS_REFRESH_MS, camFrame, camPlayerVars, type Cam, type LiveCamsResponse } from "@/lib/cams";
import { DEFAULT_SETTINGS, camAt, type Settings, type SettingsResponse } from "@/lib/settings";
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

const STATE_NAMES: Record<number, string> = { [-1]: "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };
/** Unstarted, paused or cued: the states a "play" nudge is for. */
const STOPPED = new Set([-1, 2, 5]);

const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

type PlayerStatus = { state: number; time: number };

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
      callbacks.current.onStatus({ state, time: Math.round(time) });
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
 * The whole screen: one live cam covering everything above the CHICAGO LIVE bar (the picture
 * cropped to fit). The cams are the ones switched on in /controller, taking turns when there are
 * several (?cam= picks one instead). The video fades in once it's playing; if it fails, an "offline" note shows for 2 minutes and then it's
 * tried again. A stream that follows its channel is looked up through /api/live-cams (every 10
 * minutes, and after a failure), since a restarted stream comes back under a new video ID. Under the
 * video, the dark blue CHICAGO LIVE bar, with a pulsing Chicago-flag star, the cam's name and the
 * time. ?debug=1 shows a diagnostics panel.
 */
export function LiveCams() {
  const [params, setParams] = useState<{ cam: string | null; debug: boolean } | null>(null);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setParams({ cam: search.get("cam"), debug: search.has("debug") });
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

  const picked = params?.cam ? (settings?.cams ?? CAMS).find((c) => c.id === params.cam) ?? CAMS.find((c) => c.id === params.cam) : null;
  const stream = picked ?? (settings && now !== null ? camAt(settings, now) : null);
  const channel = stream && stream.followChannel !== false ? stream.channelId : null;
  const [currentIds, setCurrentIds] = useState<Record<string, string | null>>({});
  const currentId = channel ? currentIds[channel] : null;
  const cam = stream && { ...stream, videoId: currentId || stream.videoId };

  const lookUp = useCallback(async () => {
    if (!channel) return;
    try {
      const res = (await fetch(`/api/live-cams?channels=${channel}`).then((r) => r.json())) as LiveCamsResponse;
      if (res.ok) setCurrentIds((ids) => ({ ...ids, [channel]: res.streams[channel] ?? null }));
    } catch {
      // Keep the stream we have.
    }
  }, [channel]);
  useEffect(() => {
    lookUp();
    const id = setInterval(lookUp, CAMS_REFRESH_MS);
    return () => clearInterval(id);
  }, [lookUp]);

  const [playing, setPlaying] = useState(false);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  // Shown once it first plays (a moment of buffering doesn't hide it); a new stream or retry starts hidden.
  const onPlaying = useCallback((isPlaying: boolean) => isPlaying && setPlaying(true), []);
  const playerKey = cam ? `${cam.videoId}:${attempt}` : null;
  useEffect(() => setPlaying(false), [playerKey]);
  const onFail = useCallback(
    (reason: string) => {
      setEvents((e) => [`${new Date().toLocaleTimeString()} ${reason}`, ...e].slice(0, 5));
      setPlaying(false);
      setFailedAt((at) => at ?? Date.now());
      lookUp();
    },
    [lookUp],
  );
  // After a failure, try again in a couple of minutes, with a fresh player.
  const offline = failedAt !== null && (now ?? 0) - failedAt < RETRY_MS;
  useEffect(() => {
    if (failedAt !== null && !offline) {
      setFailedAt(null);
      setAttempt((a) => a + 1);
    }
  }, [failedAt, offline]);

  if (now === null || !params || (!settings && !picked)) return <div className="live-cams" />;
  return (
    <div className="live-cams" aria-label={cam ? `Live cam: ${cam.label}` : "Live cams off"}>
      <div className="live-cams__screen">
        {cam && !offline && (
          <div className={`live-cams__cam${playing ? " live-cams__cam--shown" : ""}`}>
            <CamPlayer key={playerKey} cam={cam} onPlaying={onPlaying} onFail={onFail} onStatus={setStatus} />
          </div>
        )}
        {(!cam || offline) && <p className="live-cams__offline">{cam ? "The live cam is offline right now." : "No live cam is turned on."}</p>}
        {params.debug && (
          <pre className="live-cams__debug">
            {cam
              ? `${cam.shortLabel} ${cam.videoId}${playing ? " SHOWN" : ""} ${status ? `${STATE_NAMES[status.state] ?? status.state} t=${status.time}` : "not ready"}${offline ? " OFFLINE" : ""}`
              : "no stream on"}
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
