import { describe, expect, it } from "vitest";
import { completedEpisodeUnits, continueWatchingId, parseContinueWatching, parsePlaybackPosition, playbackPercent, playbackStorageKey, resumablePosition, updateContinueWatching, type ContinueWatchingEntry } from "./playback-progress";

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

  it("keeps only the latest episode for a source title", () => {
    const first = continueEntry({ episodeId: "episode-1", episodeNumber: 1, updatedAt: "2026-07-13T10:00:00.000Z" });
    const second = continueEntry({ episodeId: "episode-2", episodeNumber: 2, updatedAt: "2026-07-13T11:00:00.000Z" });
    expect(updateContinueWatching(updateContinueWatching([], first), second)).toEqual([second]);
    expect(updateContinueWatching([second], second, true)).toEqual([]);
  });

  it("parses valid continue entries and rejects malformed records", () => {
    const entry = continueEntry({});
    expect(parseContinueWatching(JSON.stringify([entry, { id: "broken" }]))).toEqual([entry]);
    expect(continueWatchingId("source/a", "anime:1")).toBe("source%2Fa:anime%3A1");
  });
});

function continueEntry(overrides: Partial<ContinueWatchingEntry>): ContinueWatchingEntry {
  return {
    id: continueWatchingId("source", "anime"), workId: null, sourceId: "source", sourceName: "Source",
    animeId: "anime", animeTitle: "Anime", thumbnailUrl: null, episodeId: "episode-1", episodeNumber: 1,
    episodeTitle: "Episode 1", positionSeconds: 30, durationSeconds: 100, updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}
