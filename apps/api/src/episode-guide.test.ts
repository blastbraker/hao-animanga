import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeGuideProvider } from "./episode-guide";

afterEach(() => vi.unstubAllGlobals());

describe("episode guide metadata", () => {
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
