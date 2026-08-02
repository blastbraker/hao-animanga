import { describe, expect, it } from "vitest";
import {
  blendNovelRankings,
  confidentNovelSourceMatch,
  novelSourceSearchQueries,
} from "./novel-catalog";

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

  it("tries the short franchise title before less useful AniList aliases", () => {
    const queries = novelSourceSearchQueries({
      title: "Mushoku Tensei: Jobless Reincarnation",
      alternateTitles: [
        "Mushoku Tensei: Isekai Ittara Honki Dasu",
        "無職転生 ～異世界行ったら本気だす～",
      ],
    });

    expect(queries.slice(0, 3)).toEqual([
      "Mushoku Tensei: Jobless Reincarnation",
      "Mushoku Tensei",
      "Jobless Reincarnation",
    ]);
  });

  it("accepts a reordered exact novel title but rejects the shorter base title", () => {
    const work = {
      title: "Mushoku Tensei: Jobless Reincarnation",
      alternateTitles: ["Mushoku Tensei: Isekai Ittara Honki Dasu"],
    };
    const reordered = {
      id: "readable",
      title: "Jobless Reincarnation - Mushoku Tensei",
    };

    expect(
      confidentNovelSourceMatch(work, [
        { id: "wrong", title: "Mushoku Tensei" },
        reordered,
      ]),
    ).toEqual(reordered);
    expect(
      confidentNovelSourceMatch(work, [
        { id: "wrong", title: "Mushoku Tensei" },
      ]),
    ).toBeNull();
  });
});
