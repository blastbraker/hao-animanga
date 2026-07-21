import { describe, expect, it } from "vitest";
import { confidentSourceMatch, sourceFallbackOrder } from "./source-match";

const seasonTwo = {
  title: "Skeleton Knight in Another World Season 2",
  alternateTitles: ["Gaikotsu Kishi-sama, Tadaima Isekai e Odekakechuu II"],
};

describe("confidentSourceMatch", () => {
  it("rejects a first season when metadata requests season two", () => {
    expect(confidentSourceMatch(seasonTwo, [{ title: "Skeleton Knight in Another World" }])).toBeNull();
  });

  it("accepts the exact requested season", () => {
    const item = { title: "Skeleton Knight in Another World Season 2", id: "season-2" };
    expect(confidentSourceMatch(seasonTwo, [item])).toEqual(item);
  });

  it("accepts an exact alternate title with a roman-numeral sequel", () => {
    const item = { title: "Gaikotsu Kishi-sama, Tadaima Isekai e Odekakechuu II", id: "season-2" };
    expect(confidentSourceMatch(seasonTwo, [item])).toEqual(item);
  });

  it("does not attach a sequel to base-series metadata", () => {
    expect(confidentSourceMatch({ title: "Re:ZERO -Starting Life in Another World-", alternateTitles: [] }, [{ title: "Re:ZERO -Starting Life in Another World- Season 3" }])).toBeNull();
  });

  it("matches numbered Bleach movie source titles by their full movie subtitle", () => {
    const cases = [
      {
        work: { title: "Bleach the Movie: Memories of Nobody", alternateTitles: ["BLEACH: MEMORIES OF NOBODY", "Bleach Movie 1"] },
        item: { title: "Bleach Movie 1: Memories of Nobody", id: "bleach-movie-1" },
      },
      {
        work: { title: "Bleach the Movie: The DiamondDust Rebellion", alternateTitles: ["Bleach: The Movie 2: The DiamondDust Rebellion"] },
        item: { title: "Bleach Movie 2: The DiamondDust Rebellion - Mou Hitotsu no Hyourinmaru", id: "bleach-movie-2" },
      },
      {
        work: { title: "Bleach the Movie: Fade to Black", alternateTitles: ["Bleach Movie 3"] },
        item: { title: "Bleach Movie 3: Fade to Black", id: "bleach-movie-3" },
      },
      {
        work: { title: "Bleach the Movie: Hell Verse", alternateTitles: ["Bleach Movie 4"] },
        item: { title: "Bleach Movie 4: The Hell Verse", id: "bleach-movie-4" },
      },
    ];
    for (const { work, item } of cases) expect(confidentSourceMatch(work, [item])).toEqual(item);
  });

  it("does not confuse different numbered movies in the same franchise", () => {
    const movie = {
      title: "Bleach the Movie: Memories of Nobody",
      alternateTitles: ["BLEACH: MEMORIES OF NOBODY", "Bleach Movie 1"],
    };
    expect(confidentSourceMatch(movie, [{ title: "Bleach Movie 4: The Hell Verse" }])).toBeNull();
  });

  it("prefers the main Naruto series over specials across romanization variants", () => {
    const series = { title: "Naruto: Shippuden", alternateTitles: ["NARUTO: Shippuuden"] };
    const main = { title: "Naruto: Shippuuden", id: "main-series" };
    const special = { title: "Naruto: Shippuden: Sunny Side Battle", id: "special" };
    expect(confidentSourceMatch(series, [special, main])).toEqual(main);
    expect(confidentSourceMatch({ title: series.title, alternateTitles: [] }, [special])).toBeNull();
  });
});

describe("sourceFallbackOrder", () => {
  const sources = [{ id: "one" }, { id: "two" }, { id: "three" }];

  it("tries the requested source first and preserves the remaining install order", () => {
    expect(sourceFallbackOrder(sources, "two").map((source) => source.id)).toEqual(["two", "one", "three"]);
  });

  it("keeps the install order when the requested source is unavailable", () => {
    expect(sourceFallbackOrder(sources, "missing").map((source) => source.id)).toEqual(["one", "two", "three"]);
  });
});
