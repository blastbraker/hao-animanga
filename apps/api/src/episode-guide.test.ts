import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeGuideProvider } from "./episode-guide";

afterEach(() => vi.unstubAllGlobals());

describe("episode guide metadata", () => {
  it("maps AniList to MAL and returns filler metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("anilist")) return new Response(JSON.stringify({ data: { Media: { idMal: 21 } } }), { status: 200 });
      return new Response(JSON.stringify({ data: [
        { mal_id: 1, title: "The Beginning", filler: false, recap: false, aired: "1999-10-20T00:00:00+00:00" },
        { mal_id: 2, title: "A Detour", filler: true, recap: false, aired: null },
      ], pagination: { has_next_page: false } }), { status: 200 });
    }));
    const result = await new EpisodeGuideProvider("https://anilist.test/graphql", "https://jikan.test/v4").get("30013", 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([
      { number: 1, title: "The Beginning", filler: false, recap: false, airedAt: "1999-10-20T00:00:00+00:00" },
      { number: 2, title: "A Detour", filler: true, recap: false, airedAt: null },
    ]);
  });
});
