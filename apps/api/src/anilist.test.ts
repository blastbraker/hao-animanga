import { afterEach, describe, expect, it, vi } from "vitest";
import { AniListProvider } from "./anilist";

const media = (id: number, title: string, year: number) => ({
  id, type: "ANIME", format: "TV", title: { romaji: title, english: title, native: null }, synonyms: [], description: "",
  coverImage: { extraLarge: `https://example.com/${id}.jpg`, large: null }, bannerImage: null, seasonYear: year,
  startDate: { year }, status: "FINISHED", genres: ["Fantasy"], isAdult: false, averageScore: 80, countryOfOrigin: "JP",
});

afterEach(() => vi.unstubAllGlobals());

describe("AniList anime seasons", () => {
  it("returns the current anime with its TV prequels and sequels in year order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { Media: {
      ...media(2, "Example Season 2", 2022),
      relations: { edges: [
        { relationType: "PREQUEL", node: media(1, "Example", 2020) },
        { relationType: "SEQUEL", node: media(3, "Example Movie", 2023) },
      ] },
    } } }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await new AniListProvider("https://example.test/graphql").getAnimeSeasons("2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((item) => item.title)).toEqual(["Example", "Example Season 2", "Example Movie"]);
  });
});
