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
