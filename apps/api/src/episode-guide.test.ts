import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeGuideProvider, parseIntroSkipResponse, parseOutroSkipResponse } from "./episode-guide";

afterEach(() => vi.unstubAllGlobals());

describe("episode guide metadata", () => {
  it("accepts an ending near the end, including one before a post-credits scene", () => {
    const ending = { skipType: "ed", interval: { startTime: 1_270, endTime: 1_360 }, episodeLength: 1_420 };
    expect(parseOutroSkipResponse({ found: true, results: [ending] }, 1_420)).toEqual({ ...ending.interval, source: "aniskip" });
    for (const invalid of [
      { ...ending, skipType: "op" },
      { ...ending, skipType: "mixed-ed" },
      { ...ending, episodeLength: 1_500 },
      { ...ending, interval: { startTime: 600, endTime: 690 } },
      { ...ending, interval: { startTime: 1_410, endTime: 1_510 } },
      { ...ending, interval: { startTime: "1270", endTime: 1_360 } },
    ]) expect(parseOutroSkipResponse({ found: true, results: [invalid] }, 1_420)).toBeNull();
  });

  it("fetches and caches both timings with the correct episode length", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("anilist")) return new Response(JSON.stringify({ data: { Media: { idMal: 21 } } }));
      return new Response(JSON.stringify({ found: true, results: [
        { skipType: "op", interval: { startTime: 40, endTime: 130 } },
        { skipType: "ed", interval: { startTime: 1_270, endTime: 1_360 }, episodeLength: 1_420 },
      ] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new EpisodeGuideProvider("https://anilist.test/graphql", "https://jikan.test/v4", "https://tvmaze.test", "https://aniskip.test/v2");
    const result = await provider.getSkipTimes("30013", 4, 1_420);
    expect(result).toMatchObject({ ok: true, data: {
      intro: { startTime: 40, endTime: 130 }, outro: { startTime: 1_270, endTime: 1_360 },
    } });
    const url = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(url.searchParams.getAll("types[]")).toEqual(["op", "mixed-op", "ed"]);
    expect(url.searchParams.get("episodeLength")).toBe("1420.000");
    expect(await provider.getSkipTimes("30013", 4, 1_420)).toMatchObject({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await provider.getSkipTimes("30013", 5, 1_420);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns empty timings when no metadata is available", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => String(input).includes("anilist")
      ? new Response(JSON.stringify({ data: { Media: { idMal: 21 } } }))
      : new Response("Not found", { status: 404 })));
    const provider = new EpisodeGuideProvider("https://anilist.test/graphql");
    expect(await provider.getSkipTimes("30013", 4, 1_420)).toMatchObject({ ok: true, data: { intro: null, outro: null } });
  });

  it("accepts only plausible opening intervals", () => {
    expect(parseIntroSkipResponse({ found: true, results: [{ skipType: "op", interval: { startTime: 72.5, endTime: 162.5 } }] }, 1_420)).toEqual({ startTime: 72.5, endTime: 162.5, source: "aniskip" });
    expect(parseIntroSkipResponse({ found: true, results: [{ skipType: "ed", interval: { startTime: 1_320, endTime: 1_410 } }] }, 1_420)).toBeNull();
    expect(parseIntroSkipResponse({ found: true, results: [{ skipType: "op", interval: { startTime: 0, endTime: 500 } }] }, 1_420)).toBeNull();
  });

  it("maps AniList to MAL before requesting intro metadata", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("anilist")) return new Response(JSON.stringify({ data: { Media: { idMal: 21 } } }), { status: 200 });
      return new Response(JSON.stringify({ found: true, results: [{ skipType: "op", interval: { startTime: 40, endTime: 130 } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new EpisodeGuideProvider("https://anilist.test/graphql", "https://jikan.test/v4", "https://tvmaze.test", "https://aniskip.test/v2").getIntroSkip("30013", 4, 1_420);
    expect(result).toMatchObject({ ok: true, data: { startTime: 40, endTime: 130, source: "aniskip" } });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/skip-times/21/4");
  });
  it("maps AniList to MAL and returns filler metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("anilist")) return new Response(JSON.stringify({ data: { Media: { idMal: 21, title: { english: "One Piece", romaji: "One Piece" }, startDate: { year: 1999 } } } }), { status: 200 });
      if (url.includes("tvmaze")) return new Response("Not found", { status: 404 });
      return new Response(JSON.stringify({ data: [
        { mal_id: 1, title: "The Beginning", filler: false, recap: false, aired: "1999-10-20T00:00:00+00:00" },
        { mal_id: 2, title: "A Detour", filler: true, recap: false, aired: null },
      ], pagination: { has_next_page: false } }), { status: 200 });
    }));
    const result = await new EpisodeGuideProvider("https://anilist.test/graphql", "https://jikan.test/v4").get("30013", 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([
      { number: 1, title: "The Beginning", filler: false, recap: false, airedAt: "1999-10-20T00:00:00+00:00", summary: null, thumbnailUrl: null, metadataUrl: null },
      { number: 2, title: "A Detour", filler: true, recap: false, airedAt: null, summary: null, thumbnailUrl: null, metadataUrl: null },
    ]);
  });

  it("merges safe TVMaze episode previews into the verified episode guide", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("anilist")) return new Response(JSON.stringify({ data: { Media: { idMal: 123, title: { english: "Red River", romaji: "Sora wa Akai Kawa no Hotori" }, startDate: { year: 2026 } } } }), { status: 200 });
      if (url.includes("jikan")) return new Response(JSON.stringify({ data: [
        { mal_id: 1, title: "My Dream Home", filler: false, recap: false, aired: null },
      ], pagination: { has_next_page: false } }), { status: 200 });
      return new Response(JSON.stringify({
        name: "Red River",
        premiered: "2026-04-07",
        _embedded: { episodes: [{
          season: 1,
          number: 1,
          name: "My Dream Home",
          summary: "<p>Newly cured &amp; brimming with confidence.</p>",
          airdate: "2026-04-07",
          url: "https://www.tvmaze.com/episodes/42/my-dream-home",
          image: { medium: "https://static.tvmaze.com/uploads/images/medium_landscape/1/2.jpg", original: "https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg" },
        }] },
      }), { status: 200 });
    }));

    const result = await new EpisodeGuideProvider("https://anilist.test/graphql", "https://jikan.test/v4", "https://tvmaze.test").get("42", 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]).toMatchObject({
      number: 1,
      title: "My Dream Home",
      airedAt: "2026-04-07",
      summary: "Newly cured & brimming with confidence.",
      thumbnailUrl: "https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg",
      metadataUrl: "https://www.tvmaze.com/episodes/42/my-dream-home",
    });
  });
});
