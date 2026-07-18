import { describe, expect, it } from "vitest";
import { parseActivity, parseReaderBookmarks, toggleReaderBookmark, updateActivity, updateReleaseSnapshot, type ActivityEntry, type ReaderBookmark } from "./beta-features";

describe("beta feature storage", () => {
  it("keeps the newest activity per title and caps history", () => {
    const first: ActivityEntry = { id: "anime:1", kind: "watch", title: "One", detail: "Episode 1", href: "/one", sourceName: "Source", progressPercent: 10, updatedAt: "2026-01-01T00:00:00.000Z" };
    const next = { ...first, detail: "Episode 2", updatedAt: "2026-01-02T00:00:00.000Z" };
    expect(updateActivity([first], next)).toEqual([next]);
    expect(parseActivity("not-json")).toEqual([]);
  });

  it("toggles reader bookmarks", () => {
    const bookmark: ReaderBookmark = { id: "manga:1:2", title: "Manga", chapterName: "Chapter 1", page: 2, href: "/reader", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toggleReaderBookmark([], bookmark)).toEqual([bookmark]);
    expect(toggleReaderBookmark([bookmark], bookmark)).toEqual([]);
    expect(parseReaderBookmarks(JSON.stringify([bookmark]))).toEqual([bookmark]);
  });

  it("tracks release count changes", () => {
    expect(updateReleaseSnapshot("anime:1", 12, null)).toEqual({ previous: null, snapshots: { "anime:1": 12 } });
    expect(updateReleaseSnapshot("anime:1", 13, JSON.stringify({ "anime:1": 12 })).previous).toBe(12);
  });
});
