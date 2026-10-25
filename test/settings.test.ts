import { describe, expect, it } from "vitest";
import { CAMS } from "@/lib/cams";
import { DEFAULT_SETTINGS, camAt, monthKey, normalizeSettings } from "@/lib/settings";

const river = CAMS[0];
const midway = CAMS[1];

describe("camAt", () => {
  it("takes turns among the cams switched on, by the clock", () => {
    const settings = { cams: CAMS, turnMinutes: 10 };
    expect(camAt(settings, 0)?.id).toBe("river");
    expect(camAt(settings, 10 * 60_000)?.id).toBe("midway");
    expect(camAt(settings, 20 * 60_000)?.id).toBe("river");
  });

  it("shows the one cam on, or none", () => {
    expect(camAt({ cams: [{ ...river, on: false }, midway], turnMinutes: 10 }, 0)?.id).toBe("midway");
    expect(camAt({ cams: CAMS.map((c) => ({ ...c, on: false })), turnMinutes: 10 }, 0)).toBeNull();
  });
});

describe("normalizeSettings", () => {
  it("starts with the built-in cams", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("drops malformed and repeated cams, and keeps a built-in cam's framing", () => {
    const saved = normalizeSettings({
      cams: [{ ...midway, crop: undefined }, { ...midway }, { id: "bad", shortLabel: "Bad", videoId: "nope", channelId: "x", on: true }],
      turnMinutes: 7,
    });
    expect(saved.cams).toHaveLength(1);
    expect(saved.cams[0].crop).toEqual(midway.crop);
    expect(saved.cams[0].followChannel).toBe(false);
    expect(saved.turnMinutes).toBe(DEFAULT_SETTINGS.turnMinutes);
  });
});

it("monthKey is the month in Chicago", () => {
  expect(monthKey(Date.UTC(2026, 10, 1, 3))).toBe("2026-10");
});
