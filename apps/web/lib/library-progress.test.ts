import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "@hao/domain";
import { libraryProgressLabel } from "./library-progress";

function entry(kind: LibraryEntry["work"]["kind"], completedUnits: number, positionPercent: number | null): LibraryEntry {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    work: {
      id: "10000000-0000-4000-8000-000000000002",
      kind,
      title: "Fixture",
      alternateTitles: [],
      synopsis: "",
      coverUrl: null,
      bannerUrl: null,
      year: null,
      status: null,
      genres: [],
      maturityRating: null,
      averageScore: null,
      source: { kind: "ANILIST", externalId: "1" },
    },
    status: "WATCHING_READING",
    favorite: false,
    rating: null,
    notes: "",
    progress: {
      workId: "10000000-0000-4000-8000-000000000002",
      releaseItemId: null,
      completedUnits,
      positionSeconds: null,
      positionPercent,
      updatedAt: "2026-07-18T12:00:00.000Z",
    },
    updatedAt: "2026-07-18T12:00:00.000Z",
  };
}

describe("library progress labels", () => {
  it("shows the currently playing anime episode", () => {
    expect(libraryProgressLabel(entry("ANIME", 4, 36))).toBe("Episode 5 · 36%");
  });

  it("shows exact decimal manga chapters without a fake page percentage", () => {
    expect(libraryProgressLabel(entry("MANGA", 12.5, null))).toBe("Chapter 12.5");
  });
});
