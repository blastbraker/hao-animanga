import { describe, expect, it } from "vitest";
import { blendNovelRankings } from "./novel-catalog";

describe("blended novel rankings", () => {
  it("alternates three AniList titles with three readable source titles", () => {
    const result = blendNovelRankings(
      ["a1", "a2", "a3", "a4", "a5"],
      ["s1", "s2", "s3", "s4"],
    );

    expect(result.map(({ kind, item }) => `${kind}:${item}`)).toEqual([
      "anilist:a1",
      "anilist:a2",
      "anilist:a3",
      "source:s1",
      "source:s2",
      "source:s3",
      "anilist:a4",
      "anilist:a5",
      "source:s4",
    ]);
  });
});
