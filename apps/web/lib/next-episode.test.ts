import { describe, expect, it } from "vitest";
import { nextEpisodeCountdown, normalizeOutroInterval, shouldAutoplayNext } from "./next-episode";

describe("next episode prompt", () => {
  it("appears at a known outro without skipping post-credits scenes", () => {
    const outro = { startTime: 1_070, endTime: 1_160, source: "aniskip" as const };
    expect(nextEpisodeCountdown(1_069, 1_200, 1, outro)).toBeNull();
    expect(nextEpisodeCountdown(1_070, 1_200, 1, outro)).toBe(130);
    expect(nextEpisodeCountdown(1_160, 1_200, 1, outro)).toBe(40);
    expect(nextEpisodeCountdown(1_200, 1_200, 1, outro)).toBe(0);
  });

  it("uses the last 15 seconds if the outro timing is missing or implausible", () => {
    const invalid = { startTime: 60, endTime: 150, source: "aniskip" as const };
    expect(normalizeOutroInterval(invalid, 1_200)).toBeNull();
    expect(normalizeOutroInterval(null, 1_200)).toBeNull();
    expect(nextEpisodeCountdown(1_070, 1_200, 1, invalid)).toBeNull();
    expect(nextEpisodeCountdown(1_185, 1_200, 1, invalid)).toBe(15);
  });

  it("appears only in the final 15 seconds", () => {
    expect(nextEpisodeCountdown(1_184, 1_200)).toBeNull();
    expect(nextEpisodeCountdown(1_185, 1_200)).toBe(15);
    expect(nextEpisodeCountdown(1_199.5, 1_200)).toBe(1);
    expect(nextEpisodeCountdown(1_200, 1_200)).toBe(0);
  });

  it("tracks the media clock instead of a timer when paused or seeking", () => {
    expect(nextEpisodeCountdown(1_190, 1_200)).toBe(10);
    expect(nextEpisodeCountdown(1_190, 1_200)).toBe(10);
    expect(nextEpisodeCountdown(1_000, 1_200)).toBeNull();
    expect(nextEpisodeCountdown(1_193, 1_200)).toBe(7);
  });

  it("adjusts the displayed countdown for playback speed", () => {
    expect(nextEpisodeCountdown(1_190, 1_200, 2)).toBe(5);
    expect(nextEpisodeCountdown(1_190, 1_200, 0.5)).toBe(20);
    expect(nextEpisodeCountdown(1_190, 1_200, 0)).toBe(10);
    expect(nextEpisodeCountdown(1_190, 1_200, NaN)).toBe(10);
  });

  it("handles short fixtures, invalid metadata and live streams", () => {
    expect(nextEpisodeCountdown(0, 10)).toBeNull();
    expect(nextEpisodeCountdown(5, 10)).toBe(5);
    for (const [time, duration] of [[0, 0], [0, Infinity], [NaN, 100], [-1, 100], [0, NaN]]) {
      expect(nextEpisodeCountdown(time!, duration!)).toBeNull();
    }
  });

  it("only advances at the end with autoplay enabled and no dismissal", () => {
    expect(shouldAutoplayNext(true, true, false)).toBe(true);
    expect(shouldAutoplayNext(false, true, false)).toBe(false);
    expect(shouldAutoplayNext(true, false, false)).toBe(false);
    expect(shouldAutoplayNext(true, true, true)).toBe(false);
  });
});
