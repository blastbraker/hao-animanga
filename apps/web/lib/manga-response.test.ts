import { describe, expect, it } from "vitest";
import { normalizeMangaChapterPages, normalizeMangaChapters, normalizeMangaSearchResponse, normalizeMangaSummary } from "./manga-response";

describe("manga provider response normalization", () => {
  it("turns a null chapter response into an empty list", () => {
    expect(normalizeMangaChapters(null)).toEqual([]);
  });

  it("keeps a title renderable when optional provider fields are null", () => {
    expect(normalizeMangaSummary({ id: 59, sourceId: "en", title: "Solo Leveling", genres: null }, { id: 59, sourceId: "en", title: "Fallback", genres: [] })).toEqual({
      id: 59,
      sourceId: "en",
      title: "Solo Leveling",
      genres: [],
    });
  });

  it("turns malformed catalog items into a safe empty catalog", () => {
    expect(normalizeMangaSearchResponse({ items: null, hasNextPage: null })).toEqual({ items: [], hasNextPage: false });
  });

  it("rejects malformed chapter page payloads", () => {
    expect(normalizeMangaChapterPages(null)).toBeNull();
  });
});
