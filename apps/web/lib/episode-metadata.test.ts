import { describe, expect, it } from "vitest";
import { enrichEpisodes, episodeGroupLabel } from "./episode-metadata";

describe("episode metadata", () => {
  it("uses verified guide titles and filler flags for generic source episodes", () => {
    const result = enrichEpisodes([{ id: "two", number: 2, title: "Episode 2 (sub)" }], [{ number: 2, title: "A Detour", filler: true, recap: false, airedAt: null }]);
    expect(result[0]).toMatchObject({ title: "A Detour", filler: true });
  });

  it("carries explicit source arc annotations and strips markers", () => {
    const result = enrichEpisodes([
      { id: "one", number: 1, title: "[Arc: East Blue] Romance Dawn" },
      { id: "two", number: 2, title: "They Call Him Straw Hat" },
    ], []);
    expect(result.map((item) => ({ title: item.title, arc: item.arc }))).toEqual([
      { title: "Romance Dawn", arc: "East Blue" },
      { title: "They Call Him Straw Hat", arc: "East Blue" },
    ]);
  });

  it("uses honest episode ranges when a long source has no arc metadata", () => {
    expect(episodeGroupLabel({ number: 27 }, 73)).toEqual({ kind: "range", label: "Episodes 26–50" });
  });
});
