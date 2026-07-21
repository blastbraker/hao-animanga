import { describe, expect, it } from "vitest";
import { nextPlaybackSpeed, normalizePlaybackSpeed } from "./playback-speed";

describe("playback speed", () => {
  it("accepts supported speeds and falls back safely", () => {
    expect(normalizePlaybackSpeed("1.5")).toBe(1.5);
    expect(normalizePlaybackSpeed(3)).toBe(1);
    expect(normalizePlaybackSpeed("fast")).toBe(1);
  });

  it("cycles through speeds without leaving the supported range", () => {
    expect(nextPlaybackSpeed(1)).toBe(1.25);
    expect(nextPlaybackSpeed(2)).toBe(0.5);
  });
});
