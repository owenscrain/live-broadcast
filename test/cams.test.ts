import { describe, expect, it } from "vitest";
import { CAMS, camFrame, pickCam } from "@/lib/cams";

describe("camFrame", () => {
  it("covers a full HD space with the top 13% cut off", () => {
    const f = camFrame({}, 1920, 1000);
    expect(f.top).toBe(Math.round(-0.13 * f.height));
    expect(f.height + f.top).toBeGreaterThanOrEqual(1000);
    expect(f.width / f.height).toBeCloseTo(16 / 9, 2);
    expect(Math.abs(f.left - (1920 - f.width) / 2)).toBeLessThanOrEqual(1);
  });

  it("goes wider than the height needs when the space is wider", () => {
    const f = camFrame({ crop: { top: 0 } }, 1920, 600);
    expect(f.width).toBe(1920);
    expect(f.left).toBe(0);
    expect(f.height).toBe(1080);
  });

  it("never leaves a gap at the sides", () => {
    expect(camFrame({ crop: { centerX: 0 } }, 1920, 1000).left).toBe(0);
    const right = camFrame({ crop: { centerX: 1 } }, 1920, 1000);
    expect(right.left + right.width).toBe(1920);
  });
});

describe("pickCam", () => {
  it("plays the cam ?cam= names, else the first one on", () => {
    expect(pickCam(CAMS, "midway")?.id).toBe("midway");
    expect(pickCam(CAMS, null)?.id).toBe("river");
    expect(pickCam(CAMS, "nope")?.id).toBe("river");
    expect(pickCam([], null)).toBeNull();
  });
});
