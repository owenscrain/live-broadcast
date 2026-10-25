import { NextResponse } from "next/server";
import { normalizeSettings, type SettingsResponse } from "@/lib/settings";
import { readSettings, saveSettings, storeStatus } from "@/lib/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current settings: the screen asks every minute, the controller when it opens. */
export async function GET() {
  return NextResponse.json<SettingsResponse>({ ok: true, settings: await readSettings(), store: storeStatus() });
}

/** Save the controller's settings: one Global Config write. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !Array.isArray((body as { cams?: unknown }).cams)) {
    return NextResponse.json<SettingsResponse>({ ok: false, error: "Those settings didn't come through. Reload and try again." }, { status: 400 });
  }
  const store = storeStatus();
  if (!store.writable) return NextResponse.json<SettingsResponse>({ ok: false, error: store.problem ?? "Saving isn't set up." }, { status: 503 });
  try {
    const settings = await saveSettings(normalizeSettings(body));
    return NextResponse.json<SettingsResponse>({ ok: true, settings, store });
  } catch (error) {
    return NextResponse.json<SettingsResponse>({ ok: false, error: (error as Error).message }, { status: 502 });
  }
}
