import { describe, expect, it } from "vitest";
import { episodeDisplayLabel, episodeDisplayName, episodeNumberLabel } from "./episode-title";

describe("episode titles", () => {
  it("uses a meaningful source title as the primary label", () => {
    expect(episodeDisplayName({ number: 1, title: "Episode 1 - To You, in 2000 Years" })).toBe("To You, in 2000 Years");
    expect(episodeDisplayName({ number: 4, title: "A Blade from Over 300 Years Ago" })).toBe("A Blade from Over 300 Years Ago");
    expect(episodeDisplayLabel({ number: 1, title: "Episode 1 - To You, in 2000 Years" })).toBe("To You, in 2000 Years · Episode 1");
  });

  it("falls back cleanly for generic source labels", () => {
    expect(episodeDisplayName({ number: 13, title: "Episode 13 (sub)" })).toBe("Episode 13");
    expect(episodeDisplayName({ number: 2.5, title: "" })).toBe("Episode 2.5");
    expect(episodeNumberLabel(12)).toBe("12");
  });
});
