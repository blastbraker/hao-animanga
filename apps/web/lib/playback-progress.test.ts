import { describe, expect, it } from "vitest";
import { completedEpisodeUnits, parsePlaybackPosition, playbackPercent, playbackStorageKey, resumablePosition } from "./playback-progress";

describe("anime playback progress", () => {
  it("creates an isolated key for each source title and episode", () => {
    expect(playbackStorageKey("source/a", "anime:1", "episode 2")).toBe("hao:anime-progress:source%2Fa:anime%3A1:episode%202");
  });

  it("rejects malformed stored positions", () => {
    expect(parsePlaybackPosition("not json")).toBeNull();
    expect(parsePlaybackPosition('{"positionSeconds":10,"durationSeconds":0}')).toBeNull();
  });

  it("resumes only meaningful unfinished positions", () => {
    const saved = { positionSeconds: 45, durationSeconds: 100, updatedAt: new Date().toISOString(), completed: false };
    expect(resumablePosition(saved, 100)).toBe(45);
    expect(resumablePosition({ ...saved, positionSeconds: 3 }, 100)).toBeNull();
    expect(resumablePosition({ ...saved, positionSeconds: 95 }, 100)).toBeNull();
    expect(resumablePosition({ ...saved, completed: true }, 100)).toBeNull();
  });

  it("clamps percentages and counts only completed episodes", () => {
    expect(playbackPercent(150, 100)).toBe(100);
    expect(playbackPercent(20, 0)).toBeNull();
    expect(completedEpisodeUnits(7, false)).toBe(6);
    expect(completedEpisodeUnits(7, true)).toBe(7);
  });
});
