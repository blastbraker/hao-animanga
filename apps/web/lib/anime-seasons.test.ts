import { describe, expect, it } from "vitest";
import type { Work } from "@hao/domain";
import { seasonHref, seasonOptionLabel } from "./anime-seasons";

const work = { id: "10000000-0000-4000-8000-000000000001", kind: "ANIME", title: "Re:ZERO Season 2", alternateTitles: [], synopsis: "", coverUrl: null, bannerUrl: null, year: 2020, status: null, genres: [], maturityRating: null, averageScore: null, source: { kind: "ANILIST", externalId: "108632" } } satisfies Work;

describe("anime season navigation", () => {
  it("labels and links canonical AniList seasons", () => {
    expect(seasonOptionLabel(work, 0)).toContain("Season 2");
    expect(seasonHref(work)).toBe("/title/10000000-0000-4000-8000-000000000001?anilistId=108632");
  });
});
