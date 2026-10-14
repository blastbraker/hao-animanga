import { describe, expect, it, vi } from "vitest";
import { animeSearchIdentity, animeSourceQueries, MAX_ANIME_SEARCH_QUERIES, searchAnimeSource, sourceEpisodeForPlayback } from "./anime-source-search";

const finalSeason = {
  title: "Attack on Titan Final Season",
  alternateTitles: ["Shingeki no Kyojin: The Final Season", "進撃の巨人 The Final Season", "Attack on Titan Season 4"],
};
const first = { id: "final-1", title: "Shingeki no Kyojin: The Final Season" };

describe("anime source alias search", () => {
  it("finds the Japanese title after the English search returns nothing", async () => {
    const search = vi.fn(async (query: string) => query === finalSeason.alternateTitles[0] ? [first] : []);
    expect((await searchAnimeSource(finalSeason, search)).item).toEqual(first);
    expect(search.mock.calls.flat()).toEqual([finalSeason.title, finalSeason.alternateTitles[0]]);
  });

  it("continues after unrelated or wrong-season search results, not just empty results", async () => {
    const sequel = { id: "final-2", title: "Attack on Titan Final Season Part 2" };
    const search = vi.fn().mockResolvedValueOnce([sequel]).mockResolvedValueOnce([sequel, first]);
    const result = await searchAnimeSource(finalSeason, search);
    expect(result.item).toEqual(first);
    expect(result.items).toEqual([sequel, first]);
  });

  it("stops immediately when the first search confidently matches", async () => {
    const search = vi.fn(async () => [first]);
    expect((await searchAnimeSource(finalSeason, search)).item).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("deduplicates queries, preserves native writing and bounds requests", async () => {
    const work = { title: " Attack on Titan Final Season ", alternateTitles: ["ATTACK ON TITAN: FINAL SEASON", ...finalSeason.alternateTitles, "AoT 4", "SnK 4"] };
    expect(animeSourceQueries(work)).toEqual([finalSeason.title, ...finalSeason.alternateTitles]);
    const search = vi.fn(async () => []);
    expect((await searchAnimeSource(work, search)).item).toBeNull();
    expect(search).toHaveBeenCalledTimes(MAX_ANIME_SEARCH_QUERIES);
  });

  it("does not strip season, part, or movie identity to broaden searches", async () => {
    const work = { title: "Attack on Titan Final Season Part 2", alternateTitles: ["Shingeki no Kyojin: The Final Season Part 2"] };
    const search = vi.fn(async () => [first, { id: "movie", title: "Attack on Titan: The Last Attack" }]);
    expect((await searchAnimeSource(work, search)).item).toBeNull();
    expect(search.mock.calls.flat()).toEqual([work.title, ...work.alternateTitles]);
  });

  it("keeps audio selection and only honors a verified preferred catalog ID", async () => {
    const dub = { id: "dub", title: `${first.title} (Dub)` };
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([first, dub, { id: "wrong", title: "Shingeki no Kyojin Season 2" }]);
    expect((await searchAnimeSource(finalSeason, search, { preferredId: "wrong", audioMode: "dub" })).item).toEqual(dub);
    expect((await searchAnimeSource(finalSeason, async () => [first, dub], { preferredId: "final-1" })).item).toEqual(first);
  });

  it("does not hammer an offline or rate-limited source with alias requests", async () => {
    const error = Object.assign(new Error("Rate limited"), { status: 429 });
    const search = vi.fn().mockRejectedValue(error);
    await expect(searchAnimeSource(finalSeason, search)).rejects.toBe(error);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("does not generate guesses when there are no aliases", async () => {
    const search = vi.fn(async () => []);
    await searchAnimeSource({ title: "An Unlisted Series Season 2", alternateTitles: [] }, search);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("can match a native Japanese alias without confusing unrelated native titles", async () => {
    const work = { title: "Attack on Titan Final Season Part 2", alternateTitles: ["進撃の巨人 The Final Season Part 2"] };
    const native = { id: "native", title: work.alternateTitles[0]! };
    const unrelated = { id: "unrelated", title: "別の作品 The Final Season Part 2" };
    const search = vi.fn().mockResolvedValueOnce([unrelated]).mockResolvedValueOnce([native]);
    expect((await searchAnimeSource(work, search)).item).toEqual(native);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe("fallback identity and episode", () => {
  it("retains canonical aliases when recovering from a Japanese-titled source", () => {
    const identity = animeSearchIdentity(first.title, [], finalSeason);
    expect(animeSourceQueries(identity)).toContain(finalSeason.title);
  });

  it("never reuses aliases from a previously selected different show", () => {
    expect(animeSearchIdentity("Naruto", [], finalSeason)).toEqual({ title: "Naruto", alternateTitles: [] });
    expect(animeSearchIdentity("Attack on Titan Final Season Part 2", [], finalSeason).alternateTitles).toEqual([]);
  });

  it("keeps the episode number across sources and skips a source missing it", () => {
    const episodes = [{ id: "one", number: 1 }, { id: "five", number: 5 }];
    expect(sourceEpisodeForPlayback(episodes, 5, "old-source-id")).toEqual(episodes[1]);
    expect(sourceEpisodeForPlayback(episodes, 8)).toBeNull();
    expect(sourceEpisodeForPlayback(episodes, null)).toEqual(episodes[0]);
    expect(sourceEpisodeForPlayback(episodes, 5, "one")).toEqual(episodes[0]);
  });
});
