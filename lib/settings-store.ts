import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { revalidateTag, unstable_cache } from "next/cache";
import { createClient } from "@vercel/global-config";
import { DEFAULT_SETTINGS, monthKey, normalizeSettings, type Settings, type StoreStatus } from "./settings";
import { deploymentTeamId } from "./vercel-team";

/**
 * The settings live in one item ("liveCams") of the Global Config store the CTA board also uses
 * (Hobby allows one store; its "board" item is left alone). Global Config's Hobby allowance is
 * 100,000 reads and 100 writes a month across both projects, so:
 *
 * - each Save on /controller is one write;
 * - the screens never read Global Config directly: they get a cached copy (Vercel's data cache),
 *   which a save refreshes, so the store is read about once per save instead of once a minute.
 *
 * Without Global Config (local development), settings are saved to a gitignored file, or kept in
 * memory in production so a deployment that isn't set up yet still plays the built-in cams.
 */

const KEY = "liveCams";
const TAG = "settings";

function connectionString(): string | undefined {
  return process.env.GLOBAL_CONFIG || process.env.EDGE_CONFIG || undefined;
}

/** The store id is the last path segment of the connection string (https://…/<id>?token=…). */
function configIdFrom(connection: string): string | null {
  try {
    return new URL(connection).pathname.split("/").filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

export function storeStatus(): StoreStatus {
  if (!connectionString()) {
    return { persistent: false, writable: true, problem: "Global Config isn't connected to this project, so saves don't last. See the README." };
  }
  if (!process.env.GLOBAL_CONFIG_WRITE_TOKEN) {
    return { persistent: true, writable: false, problem: "Set GLOBAL_CONFIG_WRITE_TOKEN on Vercel so this page can save. See the README." };
  }
  return { persistent: true, writable: true, problem: null };
}

const LOCAL_FILE = path.join(process.cwd(), ".live-cams.local.json");
let memory: Settings = DEFAULT_SETTINGS;

function readLocal(): Settings {
  if (process.env.NODE_ENV === "production") return memory;
  try {
    return normalizeSettings(JSON.parse(readFileSync(LOCAL_FILE, "utf8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLocal(next: Settings): void {
  memory = next;
  if (process.env.NODE_ENV !== "production") writeFileSync(LOCAL_FILE, JSON.stringify(next, null, 2));
}

/** Straight from Global Config, past its caches (so a read just after a save sees it). The built-in cams until the first save. */
async function readRemote(connection: string): Promise<Settings> {
  const value = await createClient(connection).get(KEY, { consistentRead: true });
  return value === undefined ? DEFAULT_SETTINGS : normalizeSettings(value);
}

/** Kept until a save refreshes it (and at most a day, in case a save's refresh is missed). */
const cachedRemote = unstable_cache(readRemote, [KEY], { tags: [TAG], revalidate: 86_400 });

export async function readSettings(): Promise<Settings> {
  const connection = connectionString();
  if (!connection) return readLocal();
  try {
    return await cachedRemote(connection);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function patchItem(id: string, token: string, teamId: string | null, value: Settings): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const url = new URL(`https://api.vercel.com/v1/global-config/${id}/items`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ operation: "upsert", key: KEY, value }] }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, status: res.status, message: body?.error?.message ?? `HTTP ${res.status}` };
}

/**
 * Saves the item. The store belongs to the Vercel team, and a team-scoped token only finds it when
 * the request names that team: GLOBAL_CONFIG_TEAM_ID, or else the deployment's own team. If that's
 * refused, it tries once more without a team (a token for a personal account).
 */
async function writeRemote(connection: string, next: Settings): Promise<void> {
  const id = configIdFrom(connection);
  const token = process.env.GLOBAL_CONFIG_WRITE_TOKEN;
  if (!id || !token) throw new Error(storeStatus().problem ?? "Global Config isn't set up.");
  const teamId = process.env.GLOBAL_CONFIG_TEAM_ID || (await deploymentTeamId());
  let result = await patchItem(id, token, teamId, next);
  if (!result.ok && teamId && [403, 404].includes(result.status)) result = await patchItem(id, token, null, next);
  if (!result.ok) throw new Error(`Couldn't save: ${result.message}`);
}

/** Save new settings (one Global Config write), counting the save, and refresh the screens' copy. */
export async function saveSettings(change: Settings): Promise<Settings> {
  const connection = connectionString();
  const current = await readSettings();
  const month = monthKey();
  const next: Settings = {
    ...normalizeSettings(change),
    writes: { month, count: current.writes?.month === month ? current.writes.count + 1 : 1 },
  };
  if (connection) {
    await writeRemote(connection, next);
    revalidateTag(TAG);
  } else {
    writeLocal(next);
  }
  return next;
}
