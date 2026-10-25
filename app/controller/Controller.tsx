"use client";

import { useEffect, useState } from "react";
import type { Cam } from "@/lib/cams";
import { SHORT_LABEL_MAX, TURN_CHOICES, camAt, monthKey, type Settings, type SettingsResponse, type StoreStatus } from "@/lib/settings";
import type { StreamResponse } from "@/app/api/streams/route";

/** Global Config's Hobby allowance, shared with the CTA board. */
const WRITES_PER_MONTH = 100;

const same = (a: Settings, b: Settings) => JSON.stringify([a.cams, a.turnMinutes]) === JSON.stringify([b.cams, b.turnMinutes]);

/**
 * The controller: pick which streams the screen shows (several take turns), how long each turn is,
 * and add or remove streams by YouTube link. Changes stay here until Save, which is one Global Config
 * write, so trying things out costs nothing.
 */
export function Controller() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [store, setStore] = useState<StoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json() as Promise<SettingsResponse>)
      .then((res) => {
        if (!res.ok) throw new Error(res.error);
        setSaved(res.settings);
        setDraft(res.settings);
        setStore(res.store);
      })
      .catch(() => setError("Couldn't load the settings. Reload to try again."));
  }, []);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (!draft || !saved) {
    return (
      <main className="controller">
        <h1>Chicago Live</h1>
        <p className={error ? "controller__error" : "controller__muted"}>{error ?? "Loading…"}</p>
      </main>
    );
  }

  const changed = !same(draft, saved);
  const onCount = draft.cams.filter((c) => c.on).length;
  const showing = camAt(saved, now);
  const writes = saved.writes?.month === monthKey(now) ? saved.writes.count : 0;

  const setCams = (cams: Cam[]) => {
    setDraft({ ...draft, cams });
    setNote(null);
  };
  const update = (id: string, change: Partial<Cam>) => setCams(draft.cams.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const move = (index: number, by: number) => {
    const cams = [...draft.cams];
    const [cam] = cams.splice(index, 1);
    cams.splice(index + by, 0, cam);
    setCams(cams);
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = (await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cams: draft.cams, turnMinutes: draft.turnMinutes }),
      }).then((r) => r.json())) as SettingsResponse;
      if (!res.ok) throw new Error(res.error);
      setSaved(res.settings);
      setDraft(res.settings);
      setStore(res.store);
      setNote("Saved. The screen picks it up within a minute.");
    } catch (e) {
      setError((e as Error).message || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="controller">
      <header className="controller__header">
        <h1>Chicago Live</h1>
        <a href="/" target="_blank" rel="noreferrer">
          Open the screen ↗
        </a>
      </header>

      {store?.problem && <p className="controller__warning">{store.problem}</p>}

      <section className="controller__card">
        <p className="controller__now">
          <span className="controller__dot" aria-hidden="true" />
          {showing ? (
            <>
              On screen now: <strong>{showing.shortLabel}</strong> <span className="controller__muted">({showing.label})</span>
            </>
          ) : (
            "Nothing is on screen: no stream is switched on."
          )}
        </p>
      </section>

      <section className="controller__card">
        <h2>Streams</h2>
        <p className="controller__muted">Switch on the ones to show. With more than one on, they take turns in this order.</p>
        <ul className="controller__list">
          {draft.cams.map((cam, i) => (
            <li key={cam.id} className={`controller__cam${cam.on ? " controller__cam--on" : ""}`}>
              <label className="controller__toggle">
                <input type="checkbox" checked={cam.on} onChange={(e) => update(cam.id, { on: e.target.checked })} />
                <span className="controller__switch" aria-hidden="true" />
                <span className="controller__names">
                  <strong>{cam.shortLabel}</strong>
                  <span className="controller__muted">{cam.label}</span>
                </span>
              </label>
              <span className="controller__actions">
                <a href={`https://www.youtube.com/watch?v=${cam.videoId}`} target="_blank" rel="noreferrer" title="Watch on YouTube">
                  ▶
                </a>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${cam.shortLabel} up`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.cams.length - 1} aria-label={`Move ${cam.shortLabel} down`}>
                  ↓
                </button>
                <button type="button" onClick={() => setCams(draft.cams.filter((c) => c.id !== cam.id))} aria-label={`Remove ${cam.shortLabel}`}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
        {draft.cams.length === 0 && <p className="controller__muted">No streams yet. Add one below.</p>}

        {onCount > 1 && (
          <label className="controller__turns">
            Each takes a turn of
            <select value={draft.turnMinutes} onChange={(e) => setDraft({ ...draft, turnMinutes: Number(e.target.value) })}>
              {TURN_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} {m === 1 ? "minute" : "minutes"}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <AddStream cams={draft.cams} onAdd={(cam) => setCams([...draft.cams, cam])} />

      <div className={`controller__save${changed ? " controller__save--changed" : ""}`}>
        <span className="controller__muted">
          {note ?? (changed ? "Unsaved changes." : "No changes.")} {writes} of {WRITES_PER_MONTH} saves used this month, shared with the CTA board.
        </span>
        {error && <span className="controller__error">{error}</span>}
        <span className="controller__buttons">
          <button type="button" onClick={() => setDraft(saved)} disabled={!changed || saving}>
            Undo
          </button>
          <button type="button" className="controller__primary" onClick={save} disabled={!changed || saving || store?.writable === false}>
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </main>
  );
}

/** Add a stream from a YouTube link, with its name for the CHICAGO LIVE bar. Added switched on, to the draft. */
function AddStream({ cams, onAdd }: { cams: Cam[]; onAdd: (cam: Cam) => void }) {
  const [url, setUrl] = useState("");
  const [shortLabel, setShortLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = (await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, shortLabel }),
      }).then((r) => r.json())) as StreamResponse;
      if (!res.ok) throw new Error(res.error);
      if (cams.some((c) => c.videoId === res.cam.videoId)) throw new Error("That stream is already in the list.");
      onAdd(res.cam);
      setUrl("");
      setShortLabel("");
    } catch (err) {
      setError((err as Error).message || "Couldn't add that stream.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="controller__card controller__add" onSubmit={add}>
      <h2>Add a stream</h2>
      <label>
        YouTube link
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" inputMode="url" required />
      </label>
      <label>
        Name on the bar
        <input value={shortLabel} onChange={(e) => setShortLabel(e.target.value)} placeholder="Navy Pier" maxLength={SHORT_LABEL_MAX} required />
      </label>
      {error && <p className="controller__error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Checking…" : "Add"}
      </button>
      <p className="controller__muted">Only streams whose owners allow embedding can be added. It joins the list switched on; Save to put it on screen.</p>
    </form>
  );
}
