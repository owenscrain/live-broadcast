import { describe, expect, it } from "vitest";
import { camFrame, youTubeVideoId } from "@/lib/cams";

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

describe("youTubeVideoId", () => {
  it("reads the ID from any kind of YouTube link", () => {
    expect(youTubeVideoId("https://www.youtube.com/watch?v=1hAugar3D9k&t=3")).toBe("1hAugar3D9k");
    expect(youTubeVideoId("youtu.be/1hAugar3D9k")).toBe("1hAugar3D9k");
    expect(youTubeVideoId("https://www.youtube.com/live/1hAugar3D9k?si=x")).toBe("1hAugar3D9k");
    expect(youTubeVideoId("1hAugar3D9k")).toBe("1hAugar3D9k");
    expect(youTubeVideoId("https://vimeo.com/1hAugar3D9k")).toBeNull();
  });
});
